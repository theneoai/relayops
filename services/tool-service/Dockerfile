FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
ENV NODE_ENV=development
ENV PORT=8083
EXPOSE 8083
CMD ["npm", "start"]
