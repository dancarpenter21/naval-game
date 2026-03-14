# Naval Game

A web-based Naval Battle game focused on a collaborative real-time red vs blue experience. Red is the enemy played by the AI, Blue are the players.

The game is a real-time strategy game where players must work together to overcome extremely complex scenarios and meet mission objectives. Blue controls a fleet of ships and aircraft, and must defeat the flagship of the Red fleet. Red controls a fleet of ships, aircraft, and land-based defenses, and must defend their flagship from the Blue fleet.

Players must work together to coordinate their attacks to overcome red fleet defenses and destroy the red flagship.

Most of the game takes place on the 2D map. There is also a page for unit descriptions and capabilities (pulled from Jane's Fighting Ships) and a page for mission schedules so players can coordinate their actions.

## Architecture

This game is built on a client-server architecture. The game state is maintained on the server and the client is updated in real-time. The server is a Node.js application built from a Leaflet map with Turf.js for geometry calculations. The client is a web application built from a React.js application with a Node.js backend. The game itself is an entity component system where units are airframes, boats, etc, and entity has components that define its properties, capabilities, and behaviors.

## Deployment

The game is deployed as Docker compose.yaml with one container for the server and one container for the client.