// Pressure difference from ground at which to activate (Pa)
var deltaPressure = 85; // Equivalent to 2500 ft

// Pressure at which to enable GPS (Pa)
var activationPressure = 0;

// Pressure at ground QFE (Pa)
var groundPressure;

// Pressure from barometer (Pa)
var pressure = 1013.25;

// Has closest dropzone been found
var dropzoneSelected = false;

// Closest dropzone
var dropzone;

// Distance from dropzone
var distance;

// Change in bearing to dropzone
var deltaBearing;

// Altitude to return to dropzone
var returnAltitude = 0;

// File name for flysight log
var flysightLogFile;

// Log frame for flysight log
var flysightLogFrame;

// File name for debug log
var debugLogFile;

// Log frame for debug log
var debugLogFrame;

// Last altitude (m) and time it was taken
var lastAltitude = {
  alt: 0, time: new Date()
};

const sinkRatesList = [];

const speedsList = [];

// Add item to list, if there are more than 5 values then remove first value
function addToList(list, item)
{
  if (list.length > 4)
  {
    list.shift();
  }
  list.push(item);
}

// Return average of list of numbers
function listAverage(list)
{
  total = 0;
  for(i = 0; i < list.length; i++)
  {
    total += list[i];
  }
  average = total / list.length;
  return average;
}

function degreesToRadians(degrees) {
  radians = degrees / 57.2958;
  return radians;
}

function radiansToDegrees(radians) {
  degrees = radians * 57.2958;
  return degrees;
}

function metresToFeet(metres) {
  feet = metres *  3.2808;
  return feet;
}

var netheravon = {
  lat: degreesToRadians(51.2428054), lon: degreesToRadians(-1.7620569), alt: 134.6
};

var langar = {
  lat: degreesToRadians(52.890602), lon: degreesToRadians(-0.905672), alt: 35.9
};

var sibson = {
  lat: degreesToRadians(52.561508), lon: degreesToRadians(-0.396838), alt: 40.0
};

var dunkeswell = {
  lat: degreesToRadians(50.863488), lon: degreesToRadians(-3.236506), alt: 250.0
};

var tilstock = {
  lat: degreesToRadians(52.932740), lon: degreesToRadians(-2.645203), alt: 92.0
};

var hibaldstow = {
  lat: degreesToRadians(53.497539), lon: degreesToRadians(-0.515410), alt: 9.0
};

var klatovy = {
  lat: degreesToRadians(49.418278), lon: degreesToRadians(13.321076), alt: 393.0
};

var dunkeswell = {
  lat: degreesToRadians(50.8630245), lon: degreesToRadians(-3.2363702), alt: 250.0
};

// List of dropzone, with lat, lon and alt (m)
var dropzones = [netheravon, langar, sibson, dunkeswell, tilstock, hibaldstow, klatovy];

// GPS lat and lon (rads)
var gpsRadians = {
  lat: 0, lon: 0
};

// Return distance between 2 points, not using great circle that's too hard for me (m)
function getDistance(point1, point2) {
  distance = Math.acos(Math.sin(point1.lat)*Math.sin(point2.lat)+Math.cos(point1.lat)*Math.cos(point2.lat)*Math.cos(point2.lon-point1.lon))*6371;
  return distance*1000;
}

// Returns bearing of point 2 from point 1 (degs, 0 - 360)
function getBearing(point1, point2) {
  x = Math.cos(point2.lat) * Math.sin(point2.lon - point1.lon);
  y = Math.cos(point1.lat) * Math.sin(point2.lat) - Math.sin(point1.lat) * Math.cos(point2.lat) * Math.cos(point2.lon - point1.lon);
  bearing = radiansToDegrees(Math.atan2(x, y));
  if (bearing < 0) {
    bearing += 360;
  }
  return bearing;
}

// Return altitude to make it back to dropzone (m AGL)
function getReturnAltitude(gps, distance, dropzoneAlt, sinkRate, speed) {
  altitude = gps.alt - dropzoneAlt;
  timeToTarget = distance / (speed / 3.6);
  returnAltitude = altitude - (timeToTarget * sinkRate); 
  return returnAltitude;
}

// Save sinkrate, +ve is down (m/s)
function calculateSinkRate(gps)
{
  deltaAltitude = lastAltitude.alt - gps.alt;
  deltaTime = gps.time.getTime() - lastAltitude.time.getTime();
  if (deltaTime > 0)
  {
    lastAltitude.alt = gps.alt;
    lastAltitude.time = gps.time;
    calculatedSinkRate = deltaAltitude / (deltaTime / 1000);
    if (calculatedSinkRate > 0)
    {
      addToList(sinkRatesList, calculatedSinkRate);
      return listAverage(sinkRatesList);
    }
  }
}

function calculateSpeed(speed)
{
  addToList(speedsList, speed);
  return listAverage(speedsList);
}

// If got a GPS fix for first time, get closest dropzone
// Calculate bearing and distance to closest dropzone
// If not heading towards dropzone, draw arrow towards dropzone
// If heading towards dropzone, draw estimated height to reach dropzone at.
function navigate(gps) {
  g.reset().clearRect(Bangle.appRect);
  g.setFont("Vector", 60).setFontAlign(0,0,1);
  g.clear();

  if(gps.fix == 1) {
    lastGPS = gps;
    speed = calculateSpeed(gps.speed);
    sinkRate = calculateSinkRate(gps);
    gpsRadians.lat = degreesToRadians(gps.lat);
    gpsRadians.lon = degreesToRadians(gps.lon);

    if (!dropzoneSelected) {
      dropzone = getDropzone(gpsRadians);
      dropzoneSelected = true;
    }

    distance = getDistance(gpsRadians, dropzone);
    bearing = getBearing(gpsRadians, dropzone);
    deltaBearing = gps.course - bearing;
    if (deltaBearing < -180){
      deltaBearing += 180;
    }

    if ((deltaBearing < 20) && (deltaBearing > -20)) {
      returnAltitude = getReturnAltitude(gps, distance, dropzone.alt, sinkRate, speed);
      if (returnAltitude > 0) {
        g.setColor("#00ff00");
        g.drawString(Math.round(metresToFeet(returnAltitude) / 100) * 100, 88, 88);
      } else {
        g.setColor("#0000ff");
        g.drawString("LAND\nOFF", 88, 88);
      }
    } else {
      returnAltitude = 0;
      g.drawImage(require("Storage").read("arrow.img"),88,88,{rotate:degreesToRadians(deltaBearing)});
    }

    flysightLogFrame = {
      time: Date(Date.now()).toISOString(),
      lat: gps.lat,
      lon: gps.lon,
      alt: gps.alt,
      vn: speed * Math.cos(degreesToRadians(gps.course)) * 0.36,          // velocity north (m/s)
      ve: speed * Math.sin(degreesToRadians(gps.course)) * 0.36,          // velocity east (m/s)
      vd: sinkRate,                                                           // velocity down (m/s)
      hAcc: gps.hdop * 5,
      vAcc: 1, // Maybe you could compare with baro?
      sAcc: 1,
      gpsFix: gps.fix,
      numSV: gps.satellites,
      toString: function() {
        return this.time + ","
        + this.lat + "," 
        + this.lon + ","
        + this.alt + ","
        + this.vn + ","
        + this.ve + ","
        + this.vd + ","
        + this.hAcc + ","
        + this.vAcc + ","
        + this.sAcc + ","
        + this.gpsFix + ","
        + this.numSV + "\n";
      }
    };

    debugLogFrame = {
      time: (Date.now() - loggingStartTime) / 1000,
      lat: gps.lat,
      lon: gps.lon,
      alt: gps.alt,
      speed: gps.speed * 0.36,
      course: gps.course,
      hdop: gps.hdop,
      numSV: gps.satellites, 
      sinkRate: sinkRate,
      distance: distance,
      deltaBearing: deltaBearing,
      returnAltitude: returnAltitude,
      toString: function() {
        return this.time + ","
        + this.lat + "," 
        + this.lon + ","
        + this.alt + ","
        + this.speed + ","
        + this.course + ","
        + this.hdop + ","
        + this.numSV + ","
        + this.sinkRate + ","
        + this.distance + ","
        + this.deltaBearing + ","
        + this.returnAltitude + "\n";
      }
    };
    
    if (gps.speed > 18 && gps.speed < 120)        //GPS speed between 10 and 65 kts (canopy flight)
    {
      log(flysightLogFile, flysightLogFrame);
      log(debugLogFile, debugLogFrame);
    }

  } else {
    g.setColor("#ff0000");
    g.drawString("NO\nGPS\nFIX", 88, 88);
  }
}

// Return closest dropzone
function getDropzone(gpsRadians)
{
  smallestDistanceIndex = 0;
  smallestDistance = 1000000;
  for (i = 0; i < dropzones.length; i++) {
    distance = getDistance(gpsRadians, dropzones[i]);
    if (distance < smallestDistance) {
      smallestDistanceIndex = i;
      smallestDistance = distance;
    }
  }
  return dropzones[smallestDistanceIndex];
}

var initialiseBarometerID;
var activateGPSID;

// Save GPS activation pressure and set up activate on altitude
function initialiseBarometer() {
  Bangle.getPressure().then(output=>{
      if(output)
      {
        groundPressure = output.pressure;
      }
    }).catch(function(){});
  if (groundPressure)
  {
    activationPressure = groundPressure - deltaPressure;
    clearInterval(initialiseBarometerID);
  }
}

var date;
var logTitle;
var logFile;
var loggingStartTime;

// Open flysight log and write headers
// http://www.flysight.ca/wiki/index.php/File_format
function initialiseFlysightLog() {
  date = new Date();
  logTitle = "FS_" + date.toISOString();
  flysightLogFile = require("Storage").open(logTitle,"a");
  flysightLogFile.write("time,lat,lon,hMSL,velN,velE,velD,hAcc,vAcc,sAcc,gpsFix,numSV,(deg),(deg),(m),(m/s),(m/s),(m/s),(m),(m),(m/s),,,");
}

// Open debug log and write headers
function initialiseDebugLog() {
  date = new Date();
  logTitle = "Dbug_" + date.toISOString();
  debugLogFile = require("Storage").open(logTitle,"a");
  loggingStartTime = Date.now();
  debugLogFile.write("seconds, lat, lon, alt (m), speed (m/s), course (degs), hdop, satellites, sink rate raw (m/s), DZ distance (m), DZ delta bearing (degs), DZ return (m) alt\n");
}

function displaySplash()
{
  g.reset().clearRect(Bangle.appRect);
  g.setFont("Vector", 32).setFontAlign(0,0,1);
  g.drawString("Skydive\nNav\nv1.0.7", 88, 88);
}

//Write logFrame as csv line on logFile
function log(logFile, logFrame)
{
  logFile.write(logFrame.toString());
}

function startup()
{
  displaySplash();
  initialiseBarometerID = setInterval(initialiseBarometer, 500);
}

function main()
{
  g.reset().clearRect(Bangle.appRect);
  g.setFont("Vector", 32).setFontAlign(0,0,1);
  g.drawString("Waiting\nFor\nButton...", 88, 88);
  setWatch(function() {
    checkActivateOnAltitude = false;
    Bangle.setBarometerPower(0, "app");
    Bangle.setGPSPower(1, "app");
    Bangle.on('GPS', function(gps) { navigate(gps); });
    initialiseFlysightLog();
    initialiseDebugLog();
    Bangle.buzz(200);
  }, BTN, {edge: "rising", debounce:100, repeat:false});
}

// Allow baro 1 second after power up before taking ground pressure reading
Bangle.setBarometerPower(1, "app");
startup();
setTimeout(main, 3000);


