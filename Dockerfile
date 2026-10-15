# Node.js version
FROM node:24-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# The manifest lifecycle invokes this script before the full source COPY.
COPY scripts/apply-optional-patches.js ./scripts/

# Omit development tooling; postinstall safely skips its optional cosmetic patch.
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/system/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the app
CMD [ "node", "app.js" ]
