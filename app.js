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

// Opening log file to record uploads
const logFile = fs.createWriteStream('./logs', { flags : 'a'});

// Initiating a server with the http module
const server = http.createServer( (req, res) => {
    // Handling the main process and the file uploads when a user submits a POST request
    if (req.url === '/') {
        if (req.method === 'POST') { // Performing file upload
            let form = new formidable.IncomingForm();
            form.parse(req);

            // Saving the file to the server in the uploads directory
            form.on('fileBegin', (name, file) => {
                file.path = __dirname + '/uploads/' + file.name;
            });

            // Logging the file save in the logs file
            form.on('file', (name, file) => {
                logFile.write('User uploaded file ' + file.name + ' on '
                    + new Date(Date.now()).toUTCString() + '\n');
            });
            
            // After the file uploads are done, redirects the user to a "Upload Completed" page
            req.on('end', () => {
                res.statusCode = 302;
                res.setHeader('Location', '/complete');
                res.end();
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
});

// Listening to the specified port
const port = 8080;
server.listen(port, () => {
    console.log('Listening on port ' + port.toString());
});



