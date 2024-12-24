# Node.js 이미지를 베이스로 사용
FROM node:12-alpine

# 작업 디렉토리를 /usr/src/app으로 설정
WORKDIR /usr/src/app

# package.json 및 package-lock.json 파일을 컨테이너로 복사
COPY package*.json /usr/src/app/

# 의존성 설치
RUN npm install

# 프로젝트 파일을 컨테이너로 복사
COPY . /usr/src/app/

# nodemon을 글로벌로 설치 (선택 사항)
RUN npm install -g nodemon

# 애플리케이션 포트 설정
EXPOSE 8081

# 애플리케이션 실행
CMD [ "npm", "start" ]
