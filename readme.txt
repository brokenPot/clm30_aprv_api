1. 설치
 - npm install
 - npm install -g nodemon
nodemon 설치 시 서버 변경마다 서버 재구동하지 않아도 변경 사항 반영

2. 실행
 - npm start
package.json 의 scripts 에 start 명령어로 nodemon 구동되도록 설정 되어 있음.

3. axios 사용 시
axios.get('192.168.10.197:8080/get').then(res => {
    console.log(res);
});