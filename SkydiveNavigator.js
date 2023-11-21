// Pressure difference from ground at which to activate (Pa)
var deltaPressure = 38;      //Equivalent to 2000 ft

// Pressure at which to enable GPS (Pa)
var activationPressure = 0;

// Pressure at ground QFE (Pa)
var groundPressure = Bangle.getPressure().then(output=>{groundPressure = output.pressure;});

// Pressure from barometer (Pa)
var pressure = 101325;

// Sink rate (m/s)
var sinkRate = 4000;

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

// Data for log
var logFrame = {
  lat: 0,
  lon: 0,
  alt: 0,
  speed: 0,
  course: 0,
  sinkRate: 0,
  distance: 0,
  deltaBearing: 0,
  returnAltitude: 0
};

// Last altitude and time it was taken
var lastAltitude = {
  alt: 0, time: new Date()
};

function degreesToRadians(degrees)
{
  radians = degrees / 57.2958;
  return radians;
}

function radiansToDegrees(radians)
{
  degrees = radians * 57.2958;
  return degrees;
}

function metresToFeet(metres)
{
  feet = metres *  3.2808;
  return feet;
}

var netheravon =
{
  lat: degreesToRadians(51.2428054), lon: degreesToRadians(-1.7620569)
};

var langar =
{
  lat: degreesToRadians(52.890602), lon: degreesToRadians(-0.905672)
};

var dropzones = [netheravon, langar];

// GPS lat and lon in radians, and altitude in ft for logging
var gpsRadians = 
{
  lat: 0, lon: 0
};

// Return distance between 2 points in m (not using great circle that's too hard for me)
function getDistance(point1, point2) 
{
  distance = Math.acos(Math.sin(point1.lat)*Math.sin(point2.lat)+Math.cos(point1.lat)*Math.cos(point2.lat)*Math.cos(point2.lon-point1.lon))*6371;
  return distance*1000;
}

// Returns bearing of point 2 from point 1 in degrees (0 - 360)
function getBearing(point1, point2)
{
  x = Math.cos(point2.lat) * Math.sin(point2.lon - point1.lon);
  y = Math.cos(point1.lat) * Math.sin(point2.lat) - Math.sin(point1.lat) * Math.cos(point2.lat) * Math.cos(point2.lon - point1.lon);
  bearing = radiansToDegrees(Math.atan2(x, y));
  if (bearing < 0)
  {
    bearing += 360;
  }
  return bearing;
}

// Return altitude to make it back to dropzone in metres
function getReturnAltitude(gps, distance)
{
  altitude = gps.alt;
  timeToTarget = distance / (gps.speed * 3.6);
  returnAltitude = altitude - (timeToTarget * sinkRate); 
  return returnAltitude;
}

// Save sinkrate in m/s (+ve is down)
function calculateSinkRate(gps)
{
  deltaAltitude = lastAltitude.alt - gps.alt;
  deltaTime = gps.time.getTime() - lastAltitude.time.getTime();
  if (deltaTime > 0)
  {
    lastAltitude.alt = gps.alt;
    lastAltitude.time = gps.time;
    calculatedSinkRate = deltaAltitude - (deltaTime / 1000);
    if (calculatedSinkRate > 0)
    {
      sinkRate = calcultedSinkRate;
    }
  }
}

// If got a GPS fix for first time, get closest dropzone
// Calculate bearing and distance to closest dropzone
// If not heading towards dropzone, draw arrow towards dropzone
// If heading towards dropzone, draw estimated height to reach dropzone at.
function navigate(gps)
{
  g.reset().clearRect(Bangle.appRect);
  g.setFont("Vector", 60).setFontAlign(0,0);
  g.clear();
  if(gps.fix == 1)
  {
    lastGPS = gps;
    calculateSinkRate(gps);
    gpsRadians.lat = degreesToRadians(gps.lat);
    gpsRadians.lon = degreesToRadians(gps.lon);
    gpsRadians.alt = metresToFeet(gps.alt);

    if (!dropzoneSelected)
    {
      dropzone = getDropzone(gpsRadians);
      dropzoneSelected = true;
    }

    //Calculate distance and bearing
    distance = getDistance(gpsRadians, dropzone);
    bearing = getBearing(gpsRadians, dropzone);
    deltaBearing = gps.course - bearing;
    if (deltaBearing < -180)
    {
      deltaBearing += 360;
    } 
    else if (deltaBearing > 180)
    {
      deltaBearing -= 360;
    }

    // If pointing at dropzone, draw return altitude
    // Else draw arrow towards dropzone
    if ((deltaBearing < 20) && (deltaBearing > -20))
    {
      g.setColor("#00ff00");
      returnAltitude = getReturnAltitude(gps, distance);
      g.drawString(math.round(metresToFeet(returnAltitude)), 88, 88);
    }
    else
    {
      rotationRadians = degreesToRadians(deltaBearing);
      g.drawImage(require("Storage").read("Arrow.img"),88,88,{rotate:rotationRadians});
    }

    log();
  }
  else
  {
    g.setColor("#ff0000");
    g.drawString("No GPS Fix", 88, 88);
  }
}

// Return closest dropzone
function getDropzone(gpsRadians)
{
  smallestDistanceIndex = 0;
  for (i = 0; i < dropzones.length; i++)
  {
    console.log(i);
    distance = getDistance(gpsRadians, dropzones[i]);
    console.log(distance);
    if (distance < smallestDistance)
    {
      smallestDistanceIndex = i;
      smallestDistance = distance;
    }
  }
  return dropzones[smallestDistanceIndex];
}

// Save GPS activation pressure and set up activate on altitude
function initialiseBarometer()
{
  activationPressure = groundPressure - deltaPressure;
  var activateOnAltitudeID = setInterval(activateOnAltitude, 1000);
}

// Draw current pressure and GPS activation pressure.
// If current pressure below GPS activation pressure, enable GPS navigation and disable barometer
function activateOnAltitude()
{
  Bangle.getPressure().then(output=>{pressure = output.pressure;});
  g.reset().clearRect(Bangle.appRect);
  g.setFont("12x20").setFontAlign(0,0);
  g.drawString(math.round(activationPressure), 88, 70);
  g.drawString(math.round(pressure), 88, 105);
  if (true) //(pressure < activationPressure)
  {
    checkActivateOnAltitude = false;
    Bangle.setBarometerPower(0, "app");
    Bangle.setGPSPower(1, "app");
    Bangle.on('GPS', function(gps) { navigate(gps); });
    initialiseLog();
    clearInterval(activateOnAltitudeID);
  }
}

// Open log and write headers
function initialiseLog()
{
  var date = new Date();
  var logTitle = date.toString();
  var logFile = require("Storage").open(logTitle,"a");
  var loggingStartTime = Date.now();
  logFile.write("seconds, lat, lon, alt, speed, course, sink rate, DZ distance, DZ delta bearing, DZ return alt\n");
}

function log(){
  loggingCurrentTime = (Date.now() - loggingStartTime) / 1000;
  logFile.write(loggingCurrentTime);
  logFile.write(logFrame.lat);
  logfile.write(logFrame.lon);
  logFile.write(logFrame.alt);
  logFile.write(logFrame.speed);
  logFile.write(logFrame.course);
  logFile.write(logFrame.sinkRate);
  logFile.Write(logFrame.distance);
  logFile.write(logFrame.deltaBearing);
  logFile.write(logFrame.returnAltitude);
}

// Allow baro 1 second after power up before taking ground pressure reading
Bangle.setBarometerPower(1, "app");
setTimeout(initialiseBarometer, 1000);
