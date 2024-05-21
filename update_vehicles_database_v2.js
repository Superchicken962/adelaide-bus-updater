// this is a newer newer version of the file
// Run this with PM2, as the script will run once then end to prevent database timeouts
// Made by Mark Gurney 2024

const request = require("request");
const protos = require("google-proto-files");
const mysql = require("mysql");
const { updateStaticFiles, getStaticFile, getStaticFileSync, getStopTimesByTripId, getStopTimesForTrips } = require("./static-files");
const dbInfo = require("./online_database.json");
const es = require("event-stream");
const fs = require("node:fs");

const DatabasePool = mysql.createPool(dbInfo);

const ScriptRerunTimeout = 50000;
const ScriptMaxRunsBeforeExit = 55; // 0 for no limit
let ScriptTimesRan = 0;

let stopTimes = {};

function Main() {
    // wait until static files have been checked/updated then update last seen
    updateStaticFiles().then(async(err) => {
        if (err) {
            console.log("Error in static file updating process: ", err);
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
            console.log("Script has been run 50 times! Exiting process... (Please ensure automatic reopening)");
            process.exit();
        }

        console.log(`Finished script! Re-running in ${(ScriptRerunTimeout/1000)}s. [Script has run ${ScriptTimesRan}${(ScriptMaxRunsBeforeExit > 0) ? "/"+ScriptMaxRunsBeforeExit : ""} time(s)]`);
        setTimeout(() => {
            Main();
        }, ScriptRerunTimeout);
    });
}

Main();

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
    
                        // console.log(i.id +" : "+ diff);
    
                        // hours difference less than 18 (if it is true, then do not replace)
                        return {id: i.id, lessThan18HrsAgo: Math.floor(diff/1000/60/60) < 18};
                    });
    
                    // filter to find if vehicle id exists
                    let findTrip = lastThreeVehicles_Timestamps.filter(t => t.id === trip.tripUpdate.vehicle.id);
                    findTrip = findTrip[findTrip.length - 1];
                
                    // console.log(findTrip);
    
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

const updateinterval = 5 // minutes
const error_retry = 30; // minutes

const novehiclesfound_recheck_interval = 15; // minutes

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
    
                    // let database_vehicle = allvehicles.filter(vehicle => vehicle.bus_num === info.vehicle_id)[0];
                    let database_vehicle = await getVehicleFromDatabase(info.vehicle_type, info.vehicle_id);
                    // console.log(database_vehicle);
                    
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
                    
                    // let stop = stops.filter(s => s.substr(0, vehicle.vehicle.trip.tripId.length) === vehicle.vehicle.trip.tripId);
    
                    // let first_stop = stop.filter(s => s.split(",")[4] === "0")[0];
                    // let last_stop = stop.filter(s => s.split(",")[4] === "999")[0];
    
                    // let stop = await getStopTimesByTripId(vehicle.vehicle.trip.tripId);
    
                    let tripstops = all_stop_times[vehicle.vehicle.trip.tripId]; // fetch the stop times for our trip from the object of all stop times
                    // console.log(tripstops);
    
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
                    
                    DatabasePool.getConnection((err, conn) => {
                        if (err) {
                            process.exit(err.code);
                        }
                        var query = "INSERT INTO fleetlist_lastseen (bus_num, vehicle_type, chassis, body, livery, operator, lastseen_timestamp, lastseen, previous_trips) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE bus_num = ?, lastseen_timestamp = ?, lastseen = ?, previous_trips = ?;"; // if the row exists, simply update it's lastseen info. If not, create a new row for the vehicle.
                        conn.query(query, [info.vehicle_id, info.vehicle_type, "N/A", "N/A", "N/A", "N/A", info.timestamp, JSON.stringify(info), JSON.stringify(previous_trips), info.vehicle_id, info.timestamp, JSON.stringify(info), JSON.stringify(previous_trips)], (err, results) => {
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

function getTripById(tripid, filedata) {
    let file = filedata;
    if (!filedata) {
        file = getStaticFileSync("trips.txt");
    }
    let trips = file.split("\r\n");
    let trip = trips.filter(trip => trip.split(",")[2] === tripid.toString());
    if (trip.length === 0) {
        return null;
    }
    trip = trip[0].split(",");
    let tripobj = {
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

function getRouteById(routeid, filedata) {
    let file = filedata;
    if (!filedata) {
        file = getStaticFileSync("routes.txt");
    }
    let routes = file.split("\r\n");
    let route = routes.filter(route => route.split(",")[0] === routeid.toString());
    if (route.length === 0) {
        return null;
    }

    let second = ((route[0].split('"'))[1]).replaceAll(",", "&#44;");
    let pre = [route[0].split('"')[0]];
    pre.push(second);
    pre.push(route[0].split('"')[2]);
    let final = (pre.join("")).split(",");
    let routeobj = {
        "route_id" : final[0],
        "agency_id" : final[1],
        "route_short_name" : final[2],
        "route_long_name" : final[3],
        "route_desc" : (final[4].replaceAll("&#44;", ",")),
        "route_type" : final[5],
        "route_url" : final[6],
        "route_color" : final[7],
        "route_text_color" : final[8],
        "RouteGroup" : final[9]
    };

    return routeobj;
}

function getAllVehiclesInDatabase() {
    return new Promise(async(resolve, reject) => {

        const conn = await getDatabaseConnection();

        conn.query("SELECT bus_num, lastseen, previous_trips FROM fleetlist_lastseen", (error, results, fields) => {
            if (error) {
                throw error;
            };

            resolve(results);
            conn.release();
        });
        
    });
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