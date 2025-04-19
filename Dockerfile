# Dockerfile for mixer_backend_unified.js
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install app dependencies using npm
# Use --omit=dev for newer npm, remove --ignore-scripts
RUN npm install --omit=dev

# Bundle app source inside Docker image
COPY mixer_backend_unified.js .

# App binds to port 3000 (or specified by PORT env var)
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "mixer_backend_unified.js" ]
