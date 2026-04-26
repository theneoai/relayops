FROM node:20-alpine
WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

ENV NODE_ENV=development
ENV PORT=8084

EXPOSE 8084
CMD ["npm", "start"]
