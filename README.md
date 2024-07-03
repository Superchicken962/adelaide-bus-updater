# adelaide-bus-updater
Script to automatically update Adelaide public transport information.  

Not much to say, it runs 55 times before ending in which I recommend using pm2 to have it restart automatically.  
Includes two database tables that you can just import into your database - prepopulated with vehicle data! (last updated - 03/07/2024).  

This is just a script for updating the data, if you just want to see the data visualised, my website does it here: https://apt.markgurney.dev/

Setup  
-Requires Node.js (tested on v20.9.0)  
-Recommended to use pm2 to run  
-Run 'npm install' to install all dependencies  
-Run 'node update_vehicles_database_v2.js' or 'npm start' to start the script. (If not running with pm2)  
-Make sure to configure database.json to add database information before running!  
