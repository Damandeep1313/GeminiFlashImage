# Use an official Node.js runtime as a base image
FROM node:20-slim

# Create and set working directory
WORKDIR /usr/src/app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy rest of the source code
COPY . .

# Expose port (Render uses $PORT, so we don't hardcode it)
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
