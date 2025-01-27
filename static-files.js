const request = require("request");
const fs = require("node:fs");
const jszip = require("jszip");
const es = require("event-stream");

const static_files_path = "static-data/";

function updateStaticFiles(version) {
    return new Promise(async(resolve) => {
        var newversion = "latest";
        if (version) {
            newversion = version.toString();
        }
    
        var static_files_download_url = `https://gtfs.adelaidemetro.com.au/v1/static/${newversion}/google_transit.zip`;
    
        var online_version = newversion;
        if (!version) {
            online_version = await getLatestDataVersion();
        }
        var local_version = await getLocalDataVersion();
    
        if (online_version === local_version) {
            console.log("Static files are already up to date!");
            resolve({error: null, updated: false});
            return;
        }
    
        // update
    
        await downloadZipFromURL(static_files_download_url, static_files_path+"/data.zip");
    
        fs.readFile(static_files_path+"/data.zip", (err, data) => {
            if (err) {
                resolve({error: err, updated: false});
                return;
            };
            var zip = new jszip();
            zip.loadAsync(data).then((contents) => {
                for (const filename of Object.keys(contents.files)) {
                    zip.file(filename).async("nodebuffer").then((content) => {
                        var destination = static_files_path+filename;
                        fs.writeFileSync(destination, content);
                    });
                }
            });
        });
    
        fs.writeFileSync(static_files_path+"/version.txt", online_version, "utf-8");
    
        console.log(`\nStatic files have been updated from version ${local_version} to version ${online_version}!\n\n`);
        setTimeout(() => {
            var updatenotes = fs.readFileSync(static_files_path+"/Release Notes.txt", "utf-8");
            console.log(updatenotes);
            resolve({error: null, updated: true});
        }, 1250);
    });
}

function downloadZipFromURL(zipurl, downloadpath) {
    return new Promise((resolve, reject) => {
        request.get(zipurl).pipe(fs.createWriteStream(downloadpath)).on("finish", () => {
            resolve(0);
        });
    });
}

function getLatestDataVersion() {
    return new Promise((resolve, reject) => {
        var versionurl = "https://gtfs.adelaidemetro.com.au/v1/static/latest/version.txt";
        request(versionurl, {
            method: "GET",
            encoding: "utf-8"
        }, (err, res, body) => {
            if (err) {
                console.log("Error retrieving latest data version: \n"+err);
                return;
            }
            resolve(body);
        });
    });
}

function getLocalDataVersion() {
    return new Promise((resolve, reject) => {
        fs.readFile(static_files_path+"version.txt", (err, data) => {
            if (err) {
                console.log("Error reading local data version: \n"+err);
                return;
            }
            resolve(data.toString());
        });
    });   
}

function getStaticFile(filename) {
    return new Promise((resolve, reject) => {
        fs.readFile(static_files_path+filename, "utf-8", (err, data) => {
            if (err) {
                console.log("Error reading static file: \n"+err);
                return;
            }
            resolve(data);
        });
    });
}

function getStaticFileSync(filename) {
    let content = fs.readFileSync(static_files_path+filename, "utf-8");
    return content;
}

async function getStopTimesByTripId(tripid) {
    return new Promise((resolve, reject) => {
        if (!tripid) {
            resolve([]);
            return;
        };

        let stream = fs.createReadStream(static_files_path+"stop_times.txt", "utf-8");
        let result = [];
        stream.pipe(es.split())
        .on("data", (line) => {
            if (line.substr(0, tripid.length) === tripid) {
                result.push(line);
            };
        })
        .on("end", () => {
            resolve(result);
        });
    });
}

function getStopTimesForTrips(trips_array) {
    return new Promise((resolve, reject) => {
        if (!trips_array) {
            resolve(null);
            return;
        };

        let stream = fs.createReadStream(static_files_path+"stop_times.txt", "utf-8");
        let result = {};
        stream.pipe(es.split())
        .on("data", (line) => {
            let thistripid = line.split(",")[0];
            result[thistripid] = (result[thistripid] || []);
            result[thistripid].push(line);
        })
        .on("end", () => {
            resolve(result);
        });
    });
}

module.exports = {
    updateStaticFiles,
    getStaticFile,
    getStaticFileSync,
    getStopTimesByTripId,
    getStopTimesForTrips
};