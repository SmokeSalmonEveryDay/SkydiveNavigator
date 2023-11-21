# SkydiveNavigator
Bangle.JS 2 app for skydive navigation.

This is used entirely at your own risk. Be aware of your surroundings under canopy and don't rely on GPS to navigate.

When the app is started, it will wait until 2000 ft above ground level before enabling the GPS. This is to save battery life.

For GPS nav, the whole display is shifted 90 degrees clockwise to be more easily viewed when in control of the canopy.
When there is a GPS fix, it will pick the closest dropzone from the list then display an arrow pointing towards the landing area based on GPS course.
If already heading to the landing area, the estimated altitude in ft at which you will make it to the dropzone is displayed.
