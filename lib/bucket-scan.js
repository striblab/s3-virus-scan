// Dependencies
const AWS = require('aws-sdk');
const ndjson = require('ndjson');
const path = require('path');
const fs = require('fs-extra');
const clamav = require('clamav.js');
require('dotenv').load({ silent: true });

// Error toJSON doesn't work, so make it
if (!('toJSON' in Error.prototype)) {
  Object.defineProperty(Error.prototype, 'toJSON', {
    value: function() {
      var alt = {};

      Object.getOwnPropertyNames(this).forEach(function(key) {
        alt[key] = this[key];
      }, this);

      return alt;
    },
    configurable: true,
    writable: true
  });
}

// Export function
module.exports = function(options = {}) {
  return new Promise((resolve, reject) => {
    options.output = options.output || process.cwd();
    options.bucket = options.bucket || process.env.S3_VIRUS_SCAN_BUCKET;
    options.clamPort = options.clamPort || 3310;
    options.clamHost = options.clamHost || '127.0.0.1';
    options.clamQueueMax = options.clamQueueMax || 20;
    options.updateScanned = options.updateScanned || 100;

    // Collection
    let scanned = {
      keyCount: 0,
      checkedCount: 0,
      notCheckedCount: 0,
      infectedCount: 0,
      infected: [],
      errorCount: 0,
      errors: []
    };

    // Current continuation token
    const scannedPath = path.join(
      options.output,
      `.s3-virus-scan--scanned--${options.bucket}.json`
    );
    const loadScanned = () => {
      if (fs.existsSync(scannedPath)) {
        return JSON.parse(fs.readFileSync(scannedPath, 'utf-8'));
      }
    };
    const updateScanned = update => {
      if (update === false && fs.existsSync(scannedPath)) {
        return fs.unlinkSync(scannedPath);
      }

      // Only save so often
      if (update || scanned.checkedCount % options.updateScanned === 0) {
        fs.writeFileSync(scannedPath, JSON.stringify(scanned));
      }
    };
    scanned = loadScanned() || scanned;
    let resumeScanned = scanned.checkedCount;
    scanned.keyCount = 0;

    // Queue
    let scanQueue = 0;

    // Create s3 client
    let s3Client = new AWS.S3();

    // Create ClamAV service
    let clamavService = clamav.createScanner(
      options.clamPort,
      options.clamHost
    );

    // Make sure we have a collection of keys
    const keysPath = path.join(
      options.output,
      `.s3-virus-scan--keys--${options.bucket}.nd.json`
    );
    if (!fs.existsSync(keysPath)) {
      return reject(new Error(`Unable to find key collection at ${keysPath}`));
    }

    // Start streaming key collection
    let keyStream = fs.createReadStream(keysPath).pipe(ndjson.parse());

    // Check if we are done
    let keysDone = false;
    const allDone = () => {
      if (
        keysDone &&
        scanned.checkedCount + scanned.errorCount + scanned.notCheckedCount >=
          scanned.keyCount
      ) {
        updateScanned(true);
        resolve(scanned);
      }
    };

    // Star streaming
    keyStream.on('data', key => {
      scanned.keyCount++;

      // To resume, we check to see if there's saved info
      if (resumeScanned && scanned.keyCount <= resumeScanned) {
        if (options.spinner) {
          options.spinner.text = `Resuming scanning... ${
            scanned.checkedCount
          } checked | ${scanned.infectedCount} infected | ${
            scanned.errorCount
          } errors | ${scanned.notCheckedCount} not checked`;
        }
        return;
      }

      // For some reason there are keys with trailing slashes
      // key-name/other/
      // TODO
      if (key.k.match(/\/$/)) {
        scanned.notCheckedCount++;
        return;
      }

      // Connect to file
      let s3Stream = s3Client
        .getObject({
          Bucket: options.bucket,
          Key: key.k
        })
        .createReadStream();

      // Check queue
      scanQueue++;
      if (scanQueue > options.clamQueueMax) {
        keyStream.pause();
      }

      // Scan
      clamavService.scan(s3Stream, (error, object, malicious) => {
        // Handle error
        if (error) {
          scanned.errorCount++;
          key.error = error;
          scanned.errors.push(key);
        }
        else {
          scanned.checkedCount++;
        }

        // Malicious is just a string describing the type of infection
        if (malicious) {
          scanned.infectedCount++;
          key.infected = malicious;
          scanned.infected.push(key);
        }

        // Update output
        if (options.spinner) {
          options.spinner.text = `Scanning... ${
            scanned.checkedCount
          } checked | ${scanned.infectedCount} infected | ${
            scanned.errorCount
          } errors | ${scanned.notCheckedCount} not checked`;
        }

        // Update queue
        scanQueue--;
        if (scanQueue < options.clamQueueMax) {
          keyStream.resume();
        }

        // Update scanned
        updateScanned();

        // Are we done
        allDone();
      });
    });

    keyStream.on('error', reject);
    keyStream.on('end', () => {
      // Wait for scanning to be done, check collection
      keysDone = true;
      allDone();
    });
  });
};
