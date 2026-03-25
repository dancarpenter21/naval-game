FROM node:20-alpine
WORKDIR /app

# npm dependencies (e.g. cesium, satellite.js) are declared in package.json / package-lock.json;
# `npm ci` or `npm install` in this image installs them — no host Node install required.

COPY package*.json ./
# postinstall runs vendor-milsymbol; script must exist before npm install (only package*.json copied otherwise).
COPY scripts/vendor-milsymbol.cjs ./scripts/vendor-milsymbol.cjs
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
