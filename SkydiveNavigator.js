// Pressure difference from ground at which to activate (Pa)
var deltaPressure = 38;      //Equivalent to 2000 ft

// Pressure at which to enable GPS (Pa)
var activationPressure = 0;

// Pressure at ground QFE (Pa)
var groundPressure = Bangle.getPressure().then(output=>{groundPressure = output.pressure;});

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
function getReturnAltitude(gps, distance, dropzoneAlt) {
  altitude = gps.alt - dropzoneAlt;
  timeToTarget = distance / (gps.speed * 3.6);
  returnAltitude = altitude - (timeToTarget * sinkRate); 
  return returnAltitude;
}

var sinkRate;

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
      sinkRate = calculatedSinkRate;
    }
  }
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
    calculateSinkRate(gps);
    gpsRadians.lat = degreesToRadians(gps.lat);
    gpsRadians.lon = degreesToRadians(gps.lon);

    if (!dropzoneSelected) {
      dropzone = getDropzone(gpsRadians);
      dropzoneSelected = true;
    }

    distance = getDistance(gpsRadians, dropzone);
    bearing = getBearing(gpsRadians, dropzone);
    deltaBearing = gps.course - bearing;

    if ((deltaBearing < 20) && (deltaBearing > -20)) {
      returnAltitude = getReturnAltitude(gps, distance, dropzone.alt);
      if (returnAltitude > 0) {
        g.setColor("#00ff00");
        g.drawString(Math.round(metresToFeet(returnAltitude)), 88, 88);
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
      vn: gps.speed * Math.cos(gps.course),
      ve: gps.speed * Math.sin(gps.course),
      vd: sinkRate,
      hAcc: gps.hdop * 5,
      vAcc: 1, // Maybe you could compare with baro?
      sAcc: 1,
      gpsFix: gps.fix,
      numSV: gps.satellites
    };

    debugLogFrame = {
      time: (Date.now() - loggingStartTime) / 1000,
      lat: gps.lat,
      lon: gps.lon,
      alt: gps.alt,
      speed: gps.speed,
      course: gps.course,
      sinkRate: sinkRate,
      distance: distance,
      deltaBearing: deltaBearing,
      returnAltitude: returnAltitude
    };

    log(flysightLog, flysightLogFrame);
    log(debugLog, debugLogFrame);

  } else {
    g.setColor("#ff0000");
    g.drawString("NO\nGPS\nFIX", 88, 88);
  }
}

// Return closest dropzone
function getDropzone(gpsRadians)
{
  smallestDistanceIndex = 0;
  smallestDistance = 100;
  for (i = 0; i < dropzones.length; i++) {
    console.log(i);
    distance = getDistance(gpsRadians, dropzones[i]);
    console.log(distance);
    if (distance < smallestDistance) {
      smallestDistanceIndex = i;
      smallestDistance = distance;
    }
  }
  return dropzones[smallestDistanceIndex];
}

var activateOnAltitudeID;

// Save GPS activation pressure and set up activate on altitude
function initialiseBarometer() {
  activationPressure = groundPressure - deltaPressure;
}

// Draw current pressure and GPS activation pressure.
// If current pressure below GPS activation pressure, enable GPS navigation and disable barometer
function activateOnAltitude() {
  Bangle.getPressure().then(output=>{pressure = output.pressure;});
  g.reset().clearRect(Bangle.appRect);
  g.setFont("Vector", 32).setFontAlign(0,0,1);
  g.drawString(Math.round(activationPressure), 50, 88);
  g.drawString(Math.round(pressure), 126, 88);
  if (pressure < activationPressure) {
    checkActivateOnAltitude = false;
    Bangle.setBarometerPower(0, "app");
    Bangle.setGPSPower(1, "app");
    Bangle.on('GPS', function(gps) { navigate(gps); });
    initialiseFlysightLog();
    initialiseDebugLog();
    Bangle.buzz(200);
    clearInterval(activateOnAltitudeID);
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
  logTitle = date.toString() + ".flysight";
  flysightLogFile = require("Storage").open(logTitle,"a");
}

// Open debug log and write headers
function initialiseDebugLog() {
  date = new Date();
  logTitle = date.toString() + ".debug";
  debugLogFile = require("Storage").open(logTitle,"a");
  loggingStartTime = Date.now();
  debugLogFile.write("seconds, lat, lon, alt, speed, course, sink rate, DZ distance, DZ delta bearing, DZ return alt\n");
}

function displaySplash()
{
  g.reset().clearRect(Bangle.appRect);
  g.setFont("Vector", 32).setFontAlign(0,0,1);
  g.drawString("Skydive\nNav\nv1.0.0", 88, 88);
}

//Write logFrame as csv line on logFile
function log(logFile, logFrame) {
  console.log(logFrame);
  for (i = 0; i < logFrame; i++) {
    logFile.write(item);
    logFile.write(",");
  }
  logFile.write("\n");
}

function startup()
{
  displaySplash();
  initialiseBarometer();
}

function main()
{
  activateOnAltitudeID = setInterval(activateOnAltitude, 1000); 
}

// Allow baro 1 second after power up before taking ground pressure reading
Bangle.setBarometerPower(1, "app");
setTimeout(startup, 1000);
setTimeout(main, 3000);

