FROM node:12-alpine
WORKDIR /index
COPY package*.json /index
RUN npm install
COPY . /index
CMD [ "npm", "start" ]
EXPOSE 3000
