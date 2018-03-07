// Dependencies
const AWS = require('aws-sdk');
const ndjson = require('ndjson');
const path = require('path');
const fs = require('fs-extra');
const EOL = require('os').EOL;
require('dotenv').load({ silent: true });

// Export function
module.exports = function(options = {}) {
  return new Promise((resolve, reject) => {
    options.output = options.output || process.cwd();
    options.bucket = options.bucket || process.env.S3_VIRUS_SCAN_BUCKET;

    // Check for bucket
    if (!options.bucket) {
      return reject(new Error('bucket option not provided.'));
    }

    // Setup
    const s3Client = new AWS.S3();

    // Count number of keys
    let keyCount = 0;

    // Current continuation token
    const keysTokenPath = path.join(
      options.output,
      `.s3-virus-scan--keys-token--${options.bucket}.json`
    );
    const loadKeysToken = () => {
      if (fs.existsSync(keysTokenPath)) {
        return JSON.parse(fs.readFileSync(keysTokenPath, 'utf-8')).token;
      }
    };
    const updateKeysToken = token => {
      if (token === false && fs.existsSync(keysTokenPath)) {
        return fs.unlinkSync(keysTokenPath);
      }
      fs.writeFileSync(keysTokenPath, JSON.stringify({ token: token }));
    };

    // List of keys (ndjson)
    const keysPath = path.join(
      options.output,
      `.s3-virus-scan--keys--${options.bucket}.nd.json`
    );
    const loadKeys = () => {
      let transformStream = ndjson.serialize();
      return transformStream.pipe(
        fs.createWriteStream(keysPath, { flags: 'a' })
      );
    };
    let keysStream = loadKeys();
    const updateKeys = keys => {
      if (keys && !keys.length) {
        keys = [keys];
      }

      keys.forEach(k => {
        keysStream.write(JSON.stringify(k) + EOL);
      });
    };

    // Recursive function to list all keys
    function listAllKeys(token, done) {
      let opts = { Bucket: options.bucket };
      if (token) {
        opts.ContinuationToken = token;
      }

      // Get list
      s3Client.listObjectsV2(opts, function(error, data) {
        // Error
        if (error) {
          return reject(error);
        }

        // Update key list
        updateKeys(
          data.Contents.map(k => {
            return {
              k: k.Key,
              id: k.ETag
            };
          })
        );
        keyCount = keyCount + data.Contents.length;
        if (options.spinner) {
          options.spinner.text = `Collecting... ${keyCount} so far.`;
        }

        // KEep going if needed
        if (data.IsTruncated) {
          updateKeysToken(data.NextContinuationToken);
          listAllKeys(data.NextContinuationToken, done);
        }
        else {
          updateKeysToken(false);
          done();
        }
      });
    }

    // Get current key
    let token = loadKeysToken();

    // Kick off
    listAllKeys(token, error => {
      if (error) {
        return reject(error);
      }

      keysStream.end();
      resolve(keyCount);
    });
  });
};
