# Use an official Node.js runtime as a parent image
# Using Alpine Linux variant for smaller image size
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
# Copying these first leverages Docker cache if dependencies don't change
COPY package*.json ./

# Install app dependencies using npm
# Use --production to avoid installing development dependencies
RUN npm install --production --ignore-scripts

# Bundle app source inside Docker image
COPY mixer_backend.js .

# Your app binds to port 3000, so expose it
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "mixer_backend.js" ]
