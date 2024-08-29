// Version 3 of script - mostly just v2 with some updated code quality.
// Requires config.json, static-files.js and online_database.json files.
// Made by Mark Gurney 2024

const request = require("request");
const protos = require("google-proto-files");
const mysql = require("mysql");
const { updateStaticFiles, getStaticFileSync, getStopTimesForTrips } = require("./static-files");
const es = require("event-stream");
const fs = require("node:fs");
const isProduction = !!require("./config.json").production;

// Pool will be initialised when we confirm there is stuff to edit so we do not waste connections.
let DatabasePool = null;

const ScriptRerunTimeout = 50000;
const ScriptMaxRunsBeforeExit = 55; // 0 for no limit
let ScriptTimesRan = 0;

let stopTimes = {};

function createDatabasePool() {
    const databaseInfo = (isProduction) ? require("./online_database.json") : require("./database.json");
    return mysql.createPool(databaseInfo);
}

Main();

function Main() {
    updateStaticFiles().then(async(err) => {
        if (err) {
            console.log("Error in static file updating process: ", err);
            setTimeout(() => {
                process.exit(0);
            }, 180000);
            return;
        }

        const hasLiveData = await isThereLiveData();

        if (!hasLiveData) {
            console.log("No live data - nothing to update. Ending process in 3 minutes.");
            setTimeout(() => {
                process.exit(0);
            }, 18000);
            return;
        }

        // Check if this is the first time the script is being run as we don't want to create a pool each time it updates.
        if (ScriptTimesRan === 0) {
            DatabasePool = createDatabasePool();
        }

        console.log("Cleansing Basic Trip Updates...");
        await cleanseTripUpdatesDatabase();
        console.log("Cleansed Basic Trip Updates Table\n");

        console.log("Reading Stop Times...");
        stopTimes = await readAndStoreStopTimes();
        console.log("Read and Stored Stop Times\n");

        console.log("Updating Last Seen Vehicles...");
        await updateLastSeenVehicles();
        console.log("Updated Last Seen Vehicles\n");

        console.log("Updating Trip Updates...");
        await updateTripUpdates();
        console.log("Updated Basic Trip Updates");

        ScriptTimesRan += 1;

        if ((ScriptMaxRunsBeforeExit > 0) && (ScriptTimesRan >= ScriptMaxRunsBeforeExit)) {
            console.log(`Script has been run ${ScriptMaxRunsBeforeExit} times! Exiting process... (Please ensure automatic reopening)`);
            process.exit(0);
        }

        console.log(`Finished script! Re-running in ${(ScriptRerunTimeout/1000)}s. [Script has run ${ScriptTimesRan}${(ScriptMaxRunsBeforeExit > 0) ? "/"+ScriptMaxRunsBeforeExit : ""} time(s)]`);
        setTimeout(() => {
            Main();
        }, ScriptRerunTimeout);
    });
}

const decodeProto = async(buffer) => {
    return new Promise(async(resolve, reject) => {
        const root = await protos.load("./proto/adelaidemetro.proto");
        const service = root.lookup("transit_realtime");
        var decode = service.FeedMessage.decode(buffer);
        resolve(decode);
    });
}

// remove trips no longer in static files
function cleanseTripUpdatesDatabase() {
    return new Promise(async (resolve) => {
        const static_trips = getStaticFileSync("trips.txt");
        const trips = static_trips.split("\r\n");
        const static_trip_ids = trips.map(t => t.split(",")[2]);

        const conn = await getDatabaseConnection();

        const list = static_trip_ids.map(t => "'" + t + "'").join(",");

        conn.query(`DELETE FROM basic_trip_updates WHERE tripId NOT IN(${list})`, (err, res) => {
            if (err) throw err;

            conn.release();
            resolve();
        });
        
    });
}

async function updateTripUpdates() {
    return new Promise((resolve) => {
        var req_info = {
            method: "GET",
            url: "https://gtfs.adelaidemetro.com.au/v1/realtime/trip_updates",
            encoding: null
        };
        request(req_info, async function(err, res, body) {
            if (err || res.statusCode !== 200) {
                return;
            }
    
            var feed = await decodeProto(body);
    
            if (feed.entity.length === 0) {
                console.log("No trip updates! Exiting script.");
                return;
            }
    
            const lastThreeVehicles_inDb = await getBasicTripInfoFromDatabaseForAll("tripId, lastThreeVehicles");
            if (!lastThreeVehicles_inDb) {
                return;
            }
    
            const trips_txt = getStaticFileSync("trips.txt");
    
            for (const trip of feed.entity) {
                if (!trip.tripUpdate) continue;
    
                let row = lastThreeVehicles_inDb.filter(row => row.tripId === trip.tripUpdate.trip.tripId)[0];
                let lastThreeVehicles = [];
    
                if (row && row.lastThreeVehicles) {
                    try {
                        lastThreeVehicles = JSON.parse(row.lastThreeVehicles);
                    } catch (error) {};
                }

    
                // Check if the current trip is already in the database, and skip if it is
    
                    let now = new Date();
                    let lastThreeVehicles_Timestamps = lastThreeVehicles.map((i) => {
                        let dt = new Date(parseInt(i.timestamp));
                        let diff = Math.abs(now - dt);
    
                        // hours difference less than 18 (if it is true, then do not replace)
                        return {id: i.id, lessThan18HrsAgo: Math.floor(diff/1000/60/60) < 18};
                    });
    
                    // filter to find if vehicle id exists
                    let findTrip = lastThreeVehicles_Timestamps.filter(t => t.id === trip.tripUpdate.vehicle.id);
                    findTrip = findTrip[findTrip.length - 1];
                
                    // check if it has been at least 18 hours and add vehicle if it has been (or if it does not exist)
                    if (!findTrip || findTrip.lessThan18HrsAgo !== true) {
                        lastThreeVehicles.push({id: trip.tripUpdate.vehicle.id, timestamp: Date.now()});
                    }
    
                //
    
                // sort the vehicles from recent to latest, so then we can cut out everything after the 3rd
                lastThreeVehicles.sort((a,b) => a.timestamp - b.timestamp);
                
                // limit to last 10 vehicles
                lastThreeVehicles = lastThreeVehicles.slice(-10);
    
                let type = getVehicleTypeByRoute(trip.tripUpdate.trip.routeId);
    
                let info = {
                    tripId: trip.tripUpdate.trip.tripId,
                    tripHeadsign: "",
                    routeId: trip.tripUpdate.trip.routeId,
                    vehicleId: trip.tripUpdate.vehicle.id,
                    lastThreeVehicles: JSON.stringify(lastThreeVehicles),
                    vehicleType: type,
                    vehicleUpdateTimestamp: trip.tripUpdate.timestamp.low*1000,
                    lastCheckedTimestamp: Date.now(),
                    startsAt: "N/A",
                    endsAt: "N/A"
                };
    
                let statictrip = getTripById(trip.tripUpdate.trip.tripId, trips_txt);

                let tripStopTimes = stopTimes[info.tripId];
    
                if (statictrip) {
                    // Map all stop times to return just the stop time and sequence
                    tripStopTimes = tripStopTimes.map(trip => {
                        let columns = trip.split(",");
                        let time = columns[1];
                        let sequence = columns[4];
                        return { time, sequence };
                    });

                    let first_stop = tripStopTimes.find(trip => trip.sequence == 1);
                    let last_stop = tripStopTimes.find(trip => trip.sequence == 999);

                    info.startsAt = first_stop.time;
                    info.endsAt = last_stop.time;

                    info.tripHeadsign = statictrip.trip_headsign;
                }
    
                DatabasePool.getConnection((err, conn) => {
                    if (err) throw err;
    
                    var query = "INSERT INTO basic_trip_updates (tripId, tripHeadsign, tripStartTime, tripEndTime, routeId, latestVehicleId, lastThreeVehicles, vehicleType, updateTimestamp) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE tripStartTime = ?, tripEndTime = ?, latestVehicleId = ?, lastThreeVehicles = ?, updateTimestamp = ?, routeId = ?, tripHeadsign = ?;"; // if the row exists, simply update it's lastseen info. If not, create a new row for the vehicle.
                    conn.query(query, [info.tripId, info.tripHeadsign, info.startsAt, info.endsAt, info.routeId, info.vehicleId, info.lastThreeVehicles, info.vehicleType, info.vehicleUpdateTimestamp, info.startsAt, info.endsAt, info.vehicleId, info.lastThreeVehicles, info.vehicleUpdateTimestamp, info.routeId, info.tripHeadsign], (err, results) => {
                        if (err) {
                            console.log(err);
                            return;
                        };
        
                        conn.release();
                    });
                });
            }

            resolve();
    
        });
    });
}

function updateLastSeenVehicles() {
    return new Promise((resolve, reject) => {
        // console.log("Preparing to update vehicles...");

        // console.clear();
        // console.log("Updating vehicles...");
        var req_info = {
            method: "GET",
            url: "https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions",
            encoding: null
        };
    
        request(req_info, async function (err, res, body) {
            if (err || res.statusCode !== 200) {
                throw new Error("There was an error fetching the live vehicle data.");
            }
    
            var feed = await decodeProto(body); // decode the protocol buffer
    
            if (feed.entity.length === 0) {
                console.clear();
                console.log("No Vehicles! Exiting script.");
                return;
            }
    
            let failed_entries = []; // array for failed database queries to be pushed into
            let promiseArray = []; // array for promises to be pushed into so that we can accurately wait for the for loop to finish
    
            let i = 1;
            const trip_ids = feed.entity.map(v => v.vehicle.trip.tripId); // this variable will be an array of just trip ids of all live vehicles
            const all_stop_times = await getStopTimesForTrips(trip_ids); // stop times info for each live trip
    
            const routes_txt = getStaticFileSync("routes.txt");
            const trips_txt = getStaticFileSync("trips.txt");
            const agencyData = formatAgencyData(getStaticFileSync("agency.txt"));
    
            for (const vehicle of feed.entity) {
                promiseArray.push(new Promise(async (resolve, reject) => { // push this promise into the array, and resolve it when the query is finished.
                        
                    let type = getVehicleTypeByRoute(vehicle.vehicle.trip.routeId);
    
                    var info = {
                        position: vehicle.vehicle.position,
                        trip: vehicle.vehicle.trip,
                        vehicle_id: vehicle.vehicle.vehicle.id,
                        vehicle_label: vehicle.vehicle.vehicle.label,
                        wheelchair_accessible: vehicle.vehicle.vehicle[".transit_realtime.tfnswVehicleDescriptor"],
                        timestamp: vehicle.vehicle.timestamp.low,
                        vehicle_type: type
                    };
    
                    let database_vehicle = await getVehicleFromDatabase(info.vehicle_type, info.vehicle_id);
                    
                    let previous_trips = [];
    
                    if (database_vehicle && database_vehicle.previous_trips) { // check if database_vehicle exists first, before checking if previous_trips value exists as this will throw an error if database_vehicle doesn't exist
                        try {
                            previous_trips = JSON.parse(database_vehicle.previous_trips);
                        } catch (error) {
                            previous_trips = [];
                            previous_trips.push({
                                "tripId": "0",
                                "tripHeadsign": "Possibly corrupted previous trips data",
                                "tripShapeId": "0",
                                "routeId": "Error",
                                "routeTextColour": "ffffff",
                                "routeColour": "000000",
                                "routeGroup": "0",
                                "vehicleId": "0",
                                "vehiclePosition": {
                                    "latitude": 0,
                                    "longitude": 0,
                                    "bearing": 0,
                                    "speed": 0
                                },
                                "startTime": "",
                                "tripUpdateTime": Date.now()
                            });
                        }
                    };
    
    
                    let statictrip = getTripById(vehicle.vehicle.trip.tripId, trips_txt);
                    let staticroute = getRouteById(vehicle.vehicle.trip.routeId, routes_txt);
                    
                    let tripstops = all_stop_times[vehicle.vehicle.trip.tripId]; // fetch the stop times for our trip from the object of all stop times
    
                    let prev_trip_info = {
                        tripId: vehicle.vehicle.trip.tripId,
                        tripHeadsign: "",
                        tripShapeId: "",
                        routeId: vehicle.vehicle.trip.routeId,
                        routeTextColour: "",
                        routeColour: "",
                        routeGroup: "",
                        vehicleId: vehicle.vehicle.vehicle.id,
                        vehiclePosition: vehicle.vehicle.position,
                        tripStops: tripstops,
                        startTime: "",
                        tripUpdateTime: Date.now()
                    };
    
                    if (statictrip) {
                        prev_trip_info.tripHeadsign = statictrip.trip_headsign;
                        prev_trip_info.tripShapeId = statictrip.shape_id;
                    }
                    if (staticroute) {
                        prev_trip_info.routeTextColour = staticroute.route_text_color;
                        prev_trip_info.routeColour = staticroute.route_color;
                        prev_trip_info.routeGroup = staticroute.RouteGroup;
                    }
    
                    let tripIdExists;
                    if (tripIdExists = previous_trips.filter(trip => trip.tripId === vehicle.vehicle.trip.tripId)[0]) {
                        let index = previous_trips.indexOf(tripIdExists);
                        if (index > -1) {
                            previous_trips.splice(index, 1);
                        }
                    }
    
                    // If there are 12 or more trips, we keep 12 of them. Keeps 'old' trips there until they get replaced.
                    if (previous_trips.length >= 12) {
                        // slice(-12) returns the last 12 elements in the array
                        previous_trips = previous_trips.slice(-12);
                    }
    
                    // loop backwards through loop
                    // (https://stackoverflow.com/questions/9882284/looping-through-array-and-removing-items-without-breaking-for-loop)
                    for (i = previous_trips.length - 1; i >= 0; i--) {
                        const trip = previous_trips[i];
    
                        let updatetime = trip.tripUpdateTime;
                        let _now = new Date();
                        let _saved = new Date(updatetime);
    
                        let now = _now.getDate() + "/" + (_now.getMonth() + 1) + _now.getFullYear();
                        let saved = _saved.getDate() + "/" + (_saved.getMonth() + 1) + _saved.getFullYear();
                        
                        // remove old trips from array (older than 2 days) IF there is more than 4 entries
    
                        if ((previous_trips.length >= 4) && !(_now.getMonth() == _saved.getMonth() && _now.getDate() - _saved.getDate() <= 2)) {
                            previous_trips.splice(i, 1);
                        }
    
                    }
    
                    previous_trips.push(prev_trip_info);
                    
                    // This info will be stored to the database item IF this is the first time the vehicle has been "seen."
                    const firstSeen = {
                        "trip": {
                            "id": prev_trip_info.tripId,
                            "route": prev_trip_info.routeId,
                            "headsign": prev_trip_info.tripHeadsign
                        },
                        "vehicle": {
                            "id": info.vehicle_id,
                            "type": info.vehicle_type
                        },
                        "timestamp": info.timestamp,
                        "route": {
                            "color": prev_trip_info.routeColour,
                            "text_color": prev_trip_info.routeTextColour
                        }
                    };

                    let operatorToSet = null;

                    // Handle operator
                    if (staticroute.agency_id) {
                        let findOperator = agencyData.find(agency => agency.agency_id === staticroute.agency_id);
                        
                        if (findOperator) {
                            operatorToSet = findOperator.agency_simple_name;
                        }
                    }

                    DatabasePool.getConnection((err, conn) => {
                        if (err) {
                            process.exit(err.code);
                        }

                        // Add vehicle to database if it does not exist, OR just update some values if it does. Eg. lastseen data is updated each time, while firstseen data is only updated when a new vehicle is added.
                        const query = `INSERT INTO fleetlist_lastseen (bus_num, vehicle_type, chassis, body, livery, operator, lastseen_timestamp, lastseen, previous_trips, firstseen_timestamp, firstseen) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE bus_num = ?, lastseen_timestamp = ?, lastseen = ?, previous_trips = ?${operatorToSet ? ', operator = ?' : ''};`;
                        const queryParams = [info.vehicle_id, info.vehicle_type, "N/A", "N/A", "N/A", (operatorToSet ? operatorToSet : "N/A"), info.timestamp, JSON.stringify(info), JSON.stringify(previous_trips), firstSeen.timestamp, JSON.stringify(firstSeen), info.vehicle_id, info.timestamp, JSON.stringify(info), JSON.stringify(previous_trips)];
                        if (operatorToSet) queryParams.push(operatorToSet);
                        
                        conn.query(query, queryParams, (err, results) => {
                            conn.release();
                            // console.clear();
                            // console.log(`Updating vehicles... (${i}/${feed.entity.length})`);
                            if (err) {
                                console.log(err);
                                failed_entries.push(`Error adding ${type} ${info.vehicle_id} to database!`);
                                console.log(`Error adding ${type} ${info.vehicle_id} to database! Skipping...`);
                            }
    
                            i++;
    
                            resolve();
                        });
                    });
    
                }));
            };
            
            await Promise.all(promiseArray); // wait for everything in loop to complete
    
            if (failed_entries.length > 0) {
                throw new Error(failed_entries.length + " vehicles failed to update!");
            }
            
            resolve();
        });
    });
}

function getVehicleTypeByRoute(route) {
    const trams = [
        "FESTVL",
        "GLNELG",
        "BTANIC",
        "WOMAD",
        "ADLOOP"
    ];
    const trains = [
        "BEL",
        "FLNDRS",
        "GAW",
        "GAWC",
        "GLAN",
        "GRNG",
        "NOAR",
        "OSBORN",
        "OUTHA",
        "SALIS",
        "SEAFRD",
        "PTDOCK"
    ];

    let type;

    if (trams.includes(route)) {
        type = "tram";
    } else if (trains.includes(route)) {
        type = "train";
    } else {
        type = "bus";
    }

    return type;
}

function getTripById(tripId, fileContent) {
    if (!fileContent) {
        fileContent = getStaticFileSync("trips.txt");
    }

    const trips = fileContent.split("\r\n");
    let trip = trips.find(trip => trip.split(",")[2] === tripId.toString());

    if (!trip) return null;

    trip = trip.split(",");

    const tripobj = {
        "route_id" : trip[0],
        "service_id" : trip[1],
        "trip_id" : trip[2],
        "trip_headsign" : trip[3],
        "trip_short_name" : trip[4],
        "direction_id" : trip[5],
        "block_id" : trip[6],
        "shape_id" : trip[7],
        "wheelchair_accessible" : trip[8]
    };

    return tripobj;
}

function getRouteById(routeId, fileContent) {
    if (!fileContent) {
        fileContent = getStaticFileSync("routes.txt");
    }

    let routes = fileContent.split("\r\n");
    let route = routes.find(route => route.split(",")[0] === routeId.toString());
    if (!route) return null;

    const data = splitFileText(route);

    const routeobj = {
        "route_id" : data[0],
        "agency_id" : data[1],
        "route_short_name" : data[2],
        "route_long_name" : data[3],
        "route_desc" : (data[4].replaceAll("&#44;", ",")),
        "route_type" : data[5],
        "route_url" : data[6],
        "route_color" : data[7],
        "route_text_color" : data[8],
        "RouteGroup" : data[9]
    };

    return routeobj;
}

/**
 * Format text file row into array of data - handles commas inside quotation marks. Fixes error that was occuring when reading routes without descriptions.
 * @param { string } string - String to split
 * @returns { string[] } Array of data
 */
function splitFileText(string = "") {
    // Seperate the string into 3 parts, with the second part being the description in quotes.
    const seperatedString = string.split('"');

    // If there were no quotation marks to split, then just return the original string split by a comma.
    if (seperatedString.length <= 1) {
        return string.split(",");
    }

    // Replace commas with html character code so any commas in the quotes will not affect the final split by comma into data.
    const middlePart = seperatedString[1]?.replaceAll(",", "&#44;");

    const finalString = seperatedString[0] + middlePart + seperatedString?.[2];

    // Return split array of lines + replace the HTML encoded character with a comma.
    return finalString.split(",").map(line => line.replaceAll("&#44;", ","));
}

function getVehicleFromDatabase(vehicle_type, vehicle_id) {
    return new Promise(async(resolve, reject) => {

        const conn = await getDatabaseConnection();

        conn.query("SELECT * FROM fleetlist_lastseen WHERE bus_num = ? AND vehicle_type = ?;", [vehicle_id, vehicle_type], (error, results, fields) => {
            if (error) {
                throw error;
            };

            resolve(results[0]);
            conn.release();
        });
        
    });
}

function getBasicTripInfoFromDatabaseForAll(columns) {
    return new Promise(async(resolve, reject) => {

        if (!columns) columns = "*";

        const conn = await getDatabaseConnection();

        conn.query("SELECT "+columns+" FROM basic_trip_updates", (error, results, fields) => {
            if (error) {
                throw error;
            };

            resolve(results);
            conn.release();
        });
        
    });
}

function getDatabaseConnection() {
    return new Promise((resolve) => {
        DatabasePool.getConnection((err, conn) => {
            if (err) {
                throw new Error("Error getting database connection!");
            }

            resolve(conn);
        });
    });
}

function readAndStoreStopTimes() {
    return new Promise((resolve) => {
        let stream = fs.createReadStream("static-data/stop_times.txt", "utf-8");
        let result = {};
        stream.pipe(es.split())
    
        .on("data", (line) => {
            let current_tripid = line.split(",")[0];
            result[current_tripid] = (result[current_tripid] || []);
            result[current_tripid].push(line);
        })
    
        .on("end", () => {
            resolve(result);
        });
    });
}

/**
 * Check if live data exists - are there any live trip updates, or vehicle positions?
 * @returns { Promise<Boolean> } Is there live data?
 */
function isThereLiveData() {
    return new Promise(async(resolve) => {
        const vehiclesLength = await returnFeedEntityLength("https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions");
        const tripsLength = await returnFeedEntityLength();
    
        const liveDataExists = (vehiclesLength > 2 || tripsLength > 2);
        resolve(liveDataExists);
    });
}

function returnFeedEntityLength(url = "https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions") {
    return new Promise((resolve) => {
        const options = {
            method: "GET",
            url: url,
            encoding: null
        };
    
        request(options, async function (err, res, body) {
            if (err || res.statusCode !== 200) {
                throw new Error("There was an error fetching data.");
            }
    
            const feed = await decodeProto(body); // decode the protocol buffer
    
            resolve(feed.entity.length);
        });
    });
}

/**
 * 
 * @param { string } fileContent - File content from agency.txt 
 * @param { string } return_as - Return as 'object' or 'array' - default: 'array'
 */
function formatAgencyData(fileContent = "") {
    // Trim removes any empty new lines that would return empty data.
    const data = fileContent?.trim().split("\r\n");
    
    // Remove the column names from the data.
    data.shift();

    const agencyData = [];

    for (const agency of data) {
        let string = agency.split(",");

        let info = {
            agency_id: string[0],
            agency_name: string[1],
            agency_simple_name: formatAgencyName(string[1]),
            agency_url: string[2],
            agency_timezone: string[3],
            agency_lang: string[4],
            agency_phone: string[5],
            agency_fare_url: string[6]
        }

        agencyData.push(info);
    }

    return agencyData;
}

function formatAgencyName(agency_name = "") {
    // Try and isolate the name to be just the agency name. ie. 'Torrens Transit'. Remove all brackets and "Adelaide Metro" occurences.
    agency_name = agency_name.replaceAll("Adelaide Metro", "").replaceAll("(", "").replaceAll(")", "");
    
    // Remove "School" and "Industrial" parts of agency name.
    agency_name = agency_name.replaceAll("School Service -", "").replaceAll("Industrial Service -", "");
    
    return agency_name.trim();
}