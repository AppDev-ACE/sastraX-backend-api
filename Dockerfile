# -------------------------------
# Puppeteer + Node.js Dockerfile
# -------------------------------

# Use Node.js LTS slim image
FROM node:20-slim

# Install dependencies for Puppeteer / Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    unzip \
    wget \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install Node.js dependencies (this will also install Puppeteer and download Chromium)
RUN npm install

# Copy the rest of the application code
COPY . .

# Set environment variable for Render / Cloud Run
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Start the server
CMD ["node", "captcha.js"]
