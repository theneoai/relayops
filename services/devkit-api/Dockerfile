FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
ENV NODE_ENV=development
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
