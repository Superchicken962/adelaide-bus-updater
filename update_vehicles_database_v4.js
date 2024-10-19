// Version 4 of script - updated for new database relational structure.
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

        console.log("Cleansing Trip Updates...");
        await cleanseInvalidTripsInDatabase();
        console.log("Cleansed Trip Updates Table\n");
        
        console.log("Reading Stop Times...");
        stopTimes = await readAndStoreStopTimes();
        console.log("Read and Stored Stop Times\n");

        console.log("Cleansing Last Seen Vehicles...");
        await cleanseLastSeenVehicles();
        console.log("Cleansed Last Seen Vehicles...");

        console.log("Updating Last Seen Vehicles...");
        await updateLastSeenVehicles();
        console.log("Updated Last Seen Vehicles\n");

        console.log("Updating Trip Updates...");
        await updateTrips();
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

// Remove trips that are longer in static files.
function cleanseInvalidTripsInDatabase() {
    return new Promise(async (resolve) => {
        const staticTrips = getStaticFileSync("trips.txt");
        const trips = staticTrips.split("\r\n");
        const staticTripIds = trips.map(t => t.split(",")[2]);

        const conn = await getDatabaseConnection();

        const list = staticTripIds.map(t => "'" + t + "'").join(",");

        // Rows in vehicleTrips with matching tripIds should be deleted too since they are foreign keys.
        const query = `
            DELETE FROM trips WHERE id NOT IN(${list});
        `;

        conn.query(query, (err, res) => {
            if (err) error(err);

            conn.release();
            resolve();
        });
        
    });
}

function updateTrips() {
    return new Promise(resolve => {
        const reqInfo = {
            method: "GET",
            url: "https://gtfs.adelaidemetro.com.au/v1/realtime/trip_updates",
            encoding: null
        };

        request(reqInfo, async function (err, res, body) {
            if (err || res.statusCode !== 200) {
                error(new Error("There was an error fetching the trips data."));
            }

            // Decode the protocol buffer.
            const feed = await decodeProto(body);

            if (feed.entity.length === 0) {
                // console.clear();
                console.log("No trip updates data! Ending trips update.");
                return resolve();
            }

            const tripIds = feed.entity.map(t => t.tripUpdate.trip.tripId);
    
            const tripsTxt = getStaticFileSync("trips.txt");

            const queryErrors = [];
            const conn = await getDatabaseConnection();

            await Promise.all(feed.entity.map(async(trip) => {
                let tripId = trip.tripUpdate.trip.tripId;

                let tripInfo = getTripById(tripId, tripsTxt);

                let tripStops = stopTimes[tripId] || [];
                tripStops = tripStops.map(trip => formatStopTimesData(trip.split(",")));

                const firstStop = tripStops.find(stop => stop.stop_sequence == "1");
                const lastStop = tripStops.find(stop => stop.stop_sequence == "999");

                const tripQuery = `
                    INSERT INTO trips (id, headsign, startTime, endTime, route, updateTimestamp) VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE updateTimestamp = ?;
                `;
                const tripQueryParams = [tripId, tripInfo.trip_headsign, firstStop.arrival_time, lastStop.arrival_time, tripInfo.route_id, trip.tripUpdate.timestamp.low*1000, trip.tripUpdate.timestamp.low*1000];

                const tripVehicleQuery = `
                    INSERT INTO tripVehicles (tripId, vehicleId, vehicleType, timestamp, tripStartDate) VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE vehicleId = ?, vehicleType = ?, timestamp = ?;
                `;
                let vehicleId = trip.tripUpdate.vehicle.id;
                let vehicleType = getVehicleTypeByRoute(tripInfo.route_id);
                let tripTs = trip.tripUpdate.timestamp.low*1000;

                const tripVehicleQueryParams = [tripId, vehicleId, vehicleType, tripTs, trip.tripUpdate.trip.startDate, vehicleId, vehicleType, tripTs];

                // Perform both queries and push any errors to the array. Resolve once the second is finished.
                await new Promise(r => {
                    conn.query(tripQuery, tripQueryParams, (err) => {
                        if (err) {
                            queryErrors.push(err);
                        }

                        conn.query(tripVehicleQuery, tripVehicleQueryParams, (err) => {
                            if (err) {
                                queryErrors.push(err);
                            }

                            r();
                        });
                    });
                });
            }));

            if (queryErrors.length > 0) {
                console.warn(`[Trips] ${queryErrors} error(s) occured while updating trip data. First error:`, queryErrors[0]);
            }

            conn.release();
            resolve();
        });
    });
}

function updateLastSeenVehicles() {
    return new Promise(resolve => {
        const reqInfo = {
            method: "GET",
            url: "https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions",
            encoding: null
        };

        request(reqInfo, async function (err, res, body) {
            if (err || res.statusCode !== 200) {
                error(new Error("There was an error fetching the live vehicle data."));
            }

            // Decode the protocol buffer.
            const feed = await decodeProto(body);

            if (feed.entity.length === 0) {
                // console.clear();
                console.log("No Vehicles! Ending last seen update.");
                return resolve();
            }

            // Get database connection here, as to only use 1 for all last seen rows.
            const conn = await getDatabaseConnection();

            // Get all trip ids of live vehicles, and get the stop times for each trip.
            const tripIds = feed.entity.map(v => v.vehicle.trip.tripId);
    
            const routesTxt = getStaticFileSync("routes.txt");
            const tripsTxt = getStaticFileSync("trips.txt");
            const agencyData = formatAgencyData(getStaticFileSync("agency.txt"));

            const queryErrors = [];

            // Wait for all vehicles to update.
            await Promise.all(feed.entity.map(async(vehicle) => {
                const type = getVehicleTypeByRoute(vehicle.vehicle.trip.routeId);
    
                const info = {
                    position: vehicle.vehicle.position,
                    trip: vehicle.vehicle.trip,
                    vehicle_id: vehicle.vehicle.vehicle.id,
                    vehicle_label: vehicle.vehicle.vehicle.label,
                    wheelchair_accessible: vehicle.vehicle.vehicle[".transit_realtime.tfnswVehicleDescriptor"],
                    timestamp: vehicle.vehicle.timestamp.low,
                    vehicle_type: type
                };

                let tripInfo = getTripById(vehicle.vehicle.trip.tripId, tripsTxt);
                let routeInfo = getRouteById(vehicle.vehicle.trip.routeId, routesTxt);

                let operatorToSet = null;

                // Handle operator/agency.
                if (routeInfo.agency_id) {
                    let findOperator = agencyData.find(agency => agency.agency_id === routeInfo.agency_id);
                    
                    if (findOperator) {
                        operatorToSet = findOperator.agency_simple_name;
                    }
                }

                // Query to insert/update vehicle information - if it exists in table, update operator. Only add/update operator column if the value is not null since we do not want to remove it from db if the data isn't found. 
                const vehicleInfoQuery = (operatorToSet) ?
                `INSERT INTO vehicles (id, type, operator) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE operator=?;`
                :
                `INSERT INTO vehicles (id, type) VALUES (?, ?) ON DUPLICATE KEY UPDATE id=id; `;
                
                const vehicleInfoParams = (operatorToSet) ?
                [info.vehicle_id, info.vehicle_type.toLowerCase(), operatorToSet, operatorToSet]
                :
                [info.vehicle_id, info.vehicle_type.toLowerCase(), info.vehicle_id];


                // Get stop times for this trip.
                let tripStops = stopTimes[vehicle.vehicle.trip.tripId] || [];
                tripStops = tripStops.map(trip => formatStopTimesData(trip.split(",")));

                const lastseenDetails = {
                    tripId: vehicle.vehicle.trip.tripId,
                    tripHeadsign: tripInfo?.trip_headsign || "",
                    tripShapeId: tripInfo?.shape_id || "",
                    routeId: vehicle.vehicle.trip.routeId,
                    routeTextColour: routeInfo?.route_text_color || "",
                    routeColour: routeInfo?.route_color || "",
                    routeGroup: routeInfo?.RouteGroup || "",
                    vehicleId: vehicle.vehicle.vehicle.id,
                    vehiclePosition: vehicle.vehicle.position,
                    tripStops: tripStops,
                    tripUpdateTime: Date.now(),
                };

                const firstStop = tripStops.find(stop => stop.stop_sequence == "1");
                const lastStop = tripStops.find(stop => stop.stop_sequence == "999");

                // Add data to every column for new lastseen - when updating, only change update timestamps & position info.
                // (timestamp is directly from the realtime data, and represents when the vehicle had it's data updated. updateTime is our timestamp for when the data was last fetched and updated to the database)
                const lastseenQuery = `
                    INSERT INTO lastseen (tripId, route, routeColour, routeTextColour, timestamp, latitude, longitude, bearing, speed, vehicleId, vehicleType, routeStartTime, routeEndTime, updateTime, startTime, shapeId, destination, tripStartDate)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE timestamp = ?, latitude = ?, longitude = ?, bearing = ?, speed = ?, updateTime = ?;
                `;

                const lastseenParams = [
                    lastseenDetails.tripId, lastseenDetails.routeId, lastseenDetails.routeColour, lastseenDetails.routeTextColour, info.timestamp*1000, 
                    info.position.latitude, info.position.longitude, info.position.bearing, info.position.speed, info.vehicle_id, info.vehicle_type, (firstStop.arrival_time || null), (lastStop.arrival_time || null),
                    lastseenDetails.tripUpdateTime, info.timestamp*1000, lastseenDetails.tripShapeId, lastseenDetails.tripHeadsign, info.trip.startDate,
                    info.timestamp*1000, info.position.latitude, info.position.longitude, info.position.bearing, info.position.speed, lastseenDetails.tripUpdateTime
                ];

                // Await query completion.
                await new Promise(r => {
                    // Perform the two queries.
                    conn.query(vehicleInfoQuery, vehicleInfoParams, (err) => {
                        if (err) {
                            queryErrors.push(err);
                        };

                        conn.query(lastseenQuery, lastseenParams, (err) => {
                            if (err) {
                                queryErrors.push(err);
                            };

                            r();
                        });
                    });
                });
            }));

            if (queryErrors.length > 0) {
                console.warn(`[Lastseen/vehicle] ${queryErrors} error(s) occured while updating last seen data. First error:`, queryErrors[0]);
            }

            // Resolve the update function once every vehicle has updated.
            conn.release();
            resolve();
        });
    });
}

function cleanseLastSeenVehicles() {
    return new Promise(async(resolve) => {
        const conn = await getDatabaseConnection();

        // Get all unique vehicles.
        const getQuery = `
            SELECT DISTINCT id, type FROM vehicles;
        `;

        conn.query(getQuery, async(err, res) => {
            if (err) error(err);
            
            // Await all queries for each vehicle.
            await Promise.all(res.map(async(vehicle) => {

                await new Promise(r => {
                    // Delete lastseen rows that are NOT the top 12 recent.
                    const query = `
                        DELETE FROM lastseen 
                        WHERE id NOT IN (
                            SELECT * FROM (
                                SELECT id FROM lastseen
                                WHERE vehicleId = ? AND vehicleType = ?
                                ORDER BY timestamp DESC
                                LIMIT 12
                            ) AS a
                        ) AND vehicleId = ? AND vehicleType = ?;
                    `;

                    conn.query(query, [vehicle.id, vehicle.type, vehicle.id, vehicle.type], (err, res) => {
                        if (err) error(err);

                        // Resolve this loop when query is done.
                        r();
                    });
                });

            }));

            conn.release();
            resolve();
        });
    });
}

function error(err) {
    console.error(err);
    process.exit(0);
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

function getDatabaseConnection() {
    return new Promise((resolve) => {
        DatabasePool.getConnection((err, conn) => {
            if (err) {
                error(new Error("Error getting database connection!"));
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
                error(new Error("There was an error fetching data."));
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

function formatStopTimesData(stopTimes) {
    return {
        "trip_id" : stopTimes[0],
        "arrival_time" : stopTimes[1],
        "departure_time" : stopTimes[2],
        "stop_id" : stopTimes[3],
        "stop_sequence" : stopTimes[4],
        "stop_headsign" : stopTimes[5],
        "pickup_type" : stopTimes[6],
        "drop_off_type" : stopTimes[7],
        "shape_dist_traveled" : stopTimes[8],
        "timepoint" : stopTimes[9]
    };
}