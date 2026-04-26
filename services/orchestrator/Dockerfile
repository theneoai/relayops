FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
ENV NODE_ENV=development
ENV PORT=8081
EXPOSE 8081
CMD ["npm", "start"]
