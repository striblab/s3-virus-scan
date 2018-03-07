# S3 virus scan

A set of tools to run a virus scan on all files in an S3 bucket. The main goal of this is to run a scan on every single file in a bucket and handle a large amount of files.

If you want to scan a file when it is added to S3, there are different and better strategies for this.

## Installation and setup

1. Install the [ClamAV](https://www.clamav.net/) command line.
   * On a Mac, you can install with Homebrew: `brew install clamav`
     * You will have to edit/create the configuration files (unsure, why it can't do this on install). Depending on how you have Homebrew install, the locations may change.
     * `cp /usr/local/etc/clamav/clamd.conf.sample /usr/local/etc/clamav/clamd.conf`
     * `cp /usr/local/etc/clamav/freshclam.conf.sample /usr/local/etc/clamav/freshclam.conf`
     * Edit both config files and remove/comment the "Example" line that is near the top.
   * On Linux, you should be able to do something like: `apt-get install clamav`
   * On Windows, ...
1. Make sure [NodeJS](https://nodejs.org/en/download/) is installed.
1. In this project: `npm install`
1. Update database (suggested to do this every time you run this tool): `freshclam -v`
1. AWS profile/keys (TODO)

## Usage

* Get the list of files from a bucket: `s3-virus-scan collect bucket-name`
  * Use the `--output` option to output the files to a specific location, otherwise the current directory will be used.
