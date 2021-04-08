/*
 * app.js is the main file for handling the server-side functionalities of file-uploader. 
 * It performs routing, uploading/saving files in the server, as well as logging these uploads.
 * 
 * @author : Klaus Mana
 * @version : 1.0.0
*/

// Loading modules that will be used for the program
const http = require('http');
const formidable = require('formidable');
const fs = require('fs');
const readline = require('readline');
const AWS = require('aws-sdk');
const credentials = require('./credentials.json');
const { ManagedUpload } = require('aws-sdk/clients/s3');

//Initializing the AWS service
const awsID = credentials.AWS_KEY;
const awsSECRET = credentials.AWS_SECRET;
const awsBUCKET = credentials.BucketName;
const awsLOCATION = credentials.Location;
const s3 = new AWS.S3({
    accessKeyId: awsID,
    secretAccessKey: awsSECRET
});

AWS.config.region = awsLOCATION;

// Opening log file to record uploads
const logFile = fs.createWriteStream('./logs', { flags : 'a'});

/*
* This function handles the upload stream to S3. It receives a 
* buffer from the Formidable parser and an array of buffers currently
* being analyzed.
* S3 multipart upload has a minimum part size of 5mb required,
* while formidable's form parsing gives smaller chunks while 
* going through the multipart form data. To make the formidable
* parser work with the AWS limit, this function stores each buffer
* provided by formidable in an array and only uploads a concatenated
* buffer of that array to S3 when it reaches the minimum size. Otherwise
* it concatenates the current buffer to the array and returns a call 
* saying that no upload was made yet. If the minimum size is reached and
* a part is uploaded to the S3 stream, it returns a call saying that an
* upload was made, alongside with the eTag of the current part uploaded.
* The rest is taken care of outside this function.
* 
* @param buffer
* @param bufferArray
* @return Object : { 
*                   uploaded - Indicator if an s3 uploadPart was ran or not
*                   tag - eTag the uploadPart returns
*                  }
*/
const uploadPart = (buffer, bufferArray, partNo, key, id, last) => {
    let testBuffer = Buffer.concat(bufferArray);
    let testSize = Buffer.byteLength(testBuffer);
    
    
    if (testSize < 5 * 1024 * 1024 && !last) {
        bufferArray.push(buffer);

        let uploaded = false, tag = null;
        return { uploaded, tag };
    } else {
        let uploaded = false, tag = '';
        s3.uploadPart({
            Body: testBuffer,
            Bucket: awsBUCKET,
            Key: key,
            PartNumber: partNo,
            UploadId: id
        }, (err, data) => {
            if (err) {
                console.log(err, err.stack);
            } else {
                uploaded = true;
                tag = data.ETag;
                console.log('Reached uploadPart!');
                console.log(data);
            }
        });

        return {uploaded, tag};
    }
};

const startUploadPromise = (fileName) => {
    return new Promise((resolve, reject) => {
        //Starting the upload stream to S3 when a file object is detected
        s3.createMultipartUpload({
            Bucket: awsBUCKET,
            Key: fileName
        }, (err, data) => {
            if (err) {
                console.log(err);
                return reject(err);
            } else {
                console.log('Upload Started!');
                console.log(data);
                let uploadID = data.UploadId;
                return resolve(uploadID);
            }
        });
    });
}

// Initiating a server with the http module
const server = http.createServer( (req, res) => {

    // Handling the main process and the file uploads when a user submits a POST request
    if (req.url === '/') {

        // Performing file upload
        if (req.method === 'POST') {

            let date = new Date(Date.now()).toUTCString();
            let fileName = 'ID-' + Math.floor(Math.random() * 100000).toString()
                                   + '-' + date;  //A file upload ID, so if auth is set up this value
                                           //can be set to the auth user ID. For now it just uses a random
                                          //number.

            startUploadPromise(fileName).then((id) => {
                //Formidable 
                let form = new formidable.IncomingForm();
                form.maxFileSize = 200 * 1024 * 1024 * 1024 * 1024; //Setting the max file-size to about 200TB
                form.parse(req);
            
                let partNo = 1;
                let bufferArray = [];
                let multipartTags = [];

                //Overriding the Formidable Parser to handle the upload stream ourselves.
                //This will make sure that no matter the file size, the server's memory does
                //not get overloaded but instead the file is streamed directly to S3 while
                //it is being uploaded.
                form.onPart = (part) => {
                    //Handling each part of the stream passed by formidable
                    part.on('data', (buffer) => {
                        let { uploaded, tag } = uploadPart(buffer, bufferArray, partNo,
                                                       fileName, id, false);
        
                        if (uploaded) {
                            bufferArray = [];
                            multipartTags.push({ ETag: tag, PartNumber: partNo});
                            partNo++;
                        }
                    });
                };

                req.on('end', () => {

                    // 1) Completing the multipart upload to s3 by adding the last chunk 
                    // to the upload, and calling CompleteMultiPartUpload.
                    let { uploaded, tag } = uploadPart(null, bufferArray, partNo,
                                                   fileName, id, true);
                    if (uploaded) {
                        multipartTags.push({ ETag: tag, PartNumber: partNo});
                    } else {
                        logFile.write('##Error finalizing upload for file ' + fileName);
                    }

                    s3.completeMultipartUpload({
                        Bucket: awsBUCKET,
                        Key: fileName,
                        UploadId: id,
                        MultipartUpload: multipartTags
                    }, (err, data) => {
                        if (err) {
                            console.log(err, err.stack);
                        } else {
                            console.log('Upload completed!');
                            console.log(data);
                        }
                    });

                    // 2) Logging the file save in the logs file. This file is also used
                    // for allowing the support team to see and download uploaded
                    // files.
                    logFile.write( fileName + '\n');

                    // After the file uploads are done, redirects the user to a "Upload Completed" page
                    res.statusCode = 302;
                    res.setHeader('Location', '/complete');
                    res.end();
                });
            });

        } else { // Showing the file uploader on a GET request
            fs.createReadStream(__dirname + '/public/index.html').pipe(res);
        }
    }

    // Handling the static page presented when a file upload is complete
    if (req.url === '/complete') {
        if (req.method === 'POST') { //Redirect back to root
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();        } else { // Display the page
                fs.createReadStream(__dirname + '/public/complete.html').pipe(res);
            }
    }
    
    /*  
    *   (DEPRICATED, used to work with the files saving locally, not switched to the AWS implementation yet)
    */
    if(req.url === '/files') {
        res.write('<table><tr><th>File Name</th><th>Date Uploaded</th><th>Download Link</th></tr>');
        let content = fs.createReadStream('./logs');
        let lines = readline.createInterface({ input : content });

        lines.on('line', (line) => {
            let data = line.trim().split(' | ');

            res.write('<tr><td>' + data[0] + '</td><td>' + data[1] + '</td><td><a target="_blank" href="'
            + data[2] + '">Download</a></td></tr>');
        });

    }
});

// Listening to the specified port
const port = 8080;
server.listen(port, () => {
    console.log('Listening on port ' + port.toString());
});



