FROM node:20-alpine
WORKDIR /app

# 安装依赖
COPY package.json tsconfig.json ./
RUN npm install

# 源码通过 volume 挂载，这里不 COPY
ENV NODE_ENV=development
ENV PORT=8000

EXPOSE 8000
CMD ["npm", "start"]
