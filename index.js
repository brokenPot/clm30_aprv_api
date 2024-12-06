const {Client} = require("pg");
const express = require("express");
const cors = require('cors');
const app = express();
const server = require('http').createServer(app);

const postgresql = new Client({
    user: "clm30",
    host: "192.168.10.96",
    database: "rep_clm30_beta",
    password: "clm30",
    port: 5433,
});

app.use(cors()); // cors 미들웨어
app.use(express.json());

const HOST = '192.168.10.104'; // 로컬 IP 기본값
const PORT = 8081;

//서버연결
server.listen(PORT, HOST, () => {
    postgresql.connect();
})

// 결재선 전체 get
app.get('/test/aprvDefault', async (req, res) => {
    const query = {
        text: "SELECT * FROM scc_aprv_default",
    };

    try {
        const {rows} = await postgresql.query(query); // async/await 사용으로 비동기 코드 처리
        res.status(200).json(rows); // rows를 바로 응답
    } catch (error) {
        console.error('Error fetching approval default:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 프로세스 추가
app.post('/test/insertProcess', async (req, res) => {
    const { title, info, input_id, aprv_id, def_id } = req.body;

    const queries = {
        insertProcess: `
            INSERT INTO scc_aprv_process (title, info, status, del_flag, input_id, def_id, input_dt, module_name, status_dt,
                                          cancel_opinion, confirm_dt)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP)
            RETURNING mis_id;
        `,
        selectDefaultGroupByDefId: `
           SELECT
               g.ag_num,
               g.return_ag_num,
               g.aprv_user_type,
               g.auth_id,
               g.group_name,
               g.verify_query,
               g.skip_query,
               g.aprv_user_query,
               g.aprv_skip,
               coalesce(g_order.next_ag_num, -1) as next_ag_num
           FROM
               scc_aprv_default_group g
                   left JOIN
               scc_aprv_default_group_order g_order
               ON
                   g.def_id = g_order.def_id AND g.ag_num = g_order.ag_num
           WHERE
               g.def_id = $1
        `,
        selectGroupOrderByDefIdAndAgNum: `
            SELECT next_ag_num
            FROM scc_aprv_default_group_order
            WHERE def_id = $1 AND ag_num = $2;
        `,
        selectGroupNameByNextAgNum: `
            SELECT group_name
            FROM scc_aprv_default_group
            WHERE ag_num = $1;
        `,
        insertRoute: `
            INSERT INTO scc_aprv_route (
                mis_id, ag_num, activity, activity_dt, aprv_id, opinion, delegated,
                delegator, necessary, alarm_send_result, auth_id, aprv_user_type,
                return_ag_num, next_ag_num, verify_query, aprv_user_query, skip_check, skip_query, aprv_user_list, group_name, read_dt, aprv_confirm
            )
            VALUES (
                       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,$20, CURRENT_TIMESTAMP,0
                   );
        `,
    };

    try {
        // 트랜잭션 시작
        // 1. `scc_aprv_process`에 데이터 삽입
        const { rows: processRows } = await postgresql.query(queries.insertProcess, [title, info, 0, 0, input_id, def_id]);
        const mis_id = processRows[0].mis_id;

        // 2. 기본 그룹 조회
        const { rows: formattedRouteDatas } = await postgresql.query(queries.selectDefaultGroupByDefId, [def_id]);
        let first_ag_num = 0

        // function removeInvalidRoutes(routeDatas) {
        //     if (!Array.isArray(routeDatas)) {
        //         throw new Error("Input must be an array");
        //     }
        //     let result = routeDatas.filter(route => route.ag_num === 0);
        //     console.log(`1 : ${result[0]}`)
        //     first_ag_num = result[0].next_ag_num
        //     // 리턴한 라우트의 next_ag_num을 저기 저장해준다.
        //     return routeDatas.filter(route => route.ag_num !== 0);
        // }

        const tempQuery = {
            text: "select next_ag_num from scc_aprv_default_group_order where def_id = $1 and ag_num = 0",
        };
        const { rows: tempRows } = await postgresql.query(tempQuery, [def_id]);
        first_ag_num=tempRows[0].next_ag_num
        // const targetAgNum = formattedRouteDatas[0].ag_num
        const cutOffData = formattedRouteDatas;
        // const cutOffData = removeInvalidRoutes(formattedRouteDatas)
        // 3. 각 그룹에 대한 라우트 데이터 삽입
        for (const [index, formattedRouteData] of cutOffData.entries()) {
            const { ag_num, return_ag_num,aprv_user_type,auth_id,verify_query,skip_query,aprv_user_query,aprv_skip, next_ag_num} = formattedRouteData;
            // 그룹 이름을 next_ag_num에 맞게 넣어줘야 한다.
            // 263 - 1
            // 264 - 2-1
            // 265 - 2-2
            // 266 - 3


            const aprvIdValue = ag_num === first_ag_num ? aprv_id : null;
            const activity = ag_num === first_ag_num ? 1 : 2;

            // 한단계씩 밀려있기에 next_ag_num을 넣어준다.
            // ag_num이 0인 경우, 아닌 경우
            const aprvTypeQuery = {
                text: "SELECT u.uid FROM scc_aprv_default_user du JOIN scc_user u ON du.aprv_id = u.uid WHERE def_id = $1 AND ag_num = $2",
                values: [def_id, ag_num],
            };

            const groupTypeQuery = {
                text: `SELECT u.uid
                       FROM scc_user_groups ug
                                JOIN scc_aprv_default_group udg ON ug.gid = udg.aprv_group
                                JOIN scc_user u ON ug.uid = u.uid
                       WHERE udg.def_id = $1
                         AND udg.ag_num = $2`,
                values: [def_id, ag_num],
            };

            const aprvLineTypeSqlQuery = {
                text: `SELECT udg.auth_id,udg.aprv_user_query
               FROM scc_aprv_default_group udg
               WHERE udg.def_id = $1
                 AND udg.ag_num = $2`,
                values: [def_id, ag_num],
            };
            function extractUids(array) {
                return array.map(item => item.uid).join(', ');
            }

            // 결재 그룹 타입 별로 aprv_user_list 칼럼에 결재자 넣어주기
            // let aprvList = [];
            if (aprv_user_type === 0){
                const aprvTypeData = await postgresql.query(aprvTypeQuery);
                const aprvTypeNextAprv = aprvTypeData.rows.length > 0
                    ? aprvTypeData.rows.sort((a, b) => b.default_check - a.default_check)
                    : [];
                const aprvList=extractUids(aprvTypeNextAprv)
                let groupName = '';
                // if (next_ag_num !== -1) {
                const { rows: groupNameRows } = await postgresql.query(queries.selectGroupNameByNextAgNum, [ag_num]);
                groupName = groupNameRows.length > 0 ? groupNameRows[0].group_name : '';
                // }

                // 라우트 삽입
                await postgresql.query(queries.insertRoute, [
                    mis_id, ag_num, activity, null, aprvIdValue, '', 0, null, 0, '', auth_id,
                    aprv_user_type, return_ag_num, next_ag_num, verify_query, aprv_user_query, aprv_skip, skip_query, aprvList,groupName
                ]);
            }else if(aprv_user_type === 1){
                const groupTypeData = await postgresql.query(groupTypeQuery);
                const groupTypeNextAprv = groupTypeData.rows.length > 0 ? groupTypeData.rows : [];
                const aprvList= extractUids(groupTypeNextAprv)
                let groupName = '';
                // if (next_ag_num !== -1) {
                    const { rows: groupNameRows } = await postgresql.query(queries.selectGroupNameByNextAgNum, [ag_num]);
                    groupName = groupNameRows.length > 0 ? groupNameRows[0].group_name : '';
                // }
                // 라우트 삽입
                await postgresql.query(queries.insertRoute, [
                    mis_id, ag_num, activity, null, aprvIdValue, '', 0, null, 0, '', auth_id,
                    aprv_user_type, return_ag_num, next_ag_num, verify_query, aprv_user_query, aprv_skip, skip_query, aprvList,groupName
                ]);
            }else{
                // aprv_user_type이 2일 때
                const aprvLineTypeSqlQueryData = await postgresql.query(aprvLineTypeSqlQuery);
                if (aprvLineTypeSqlQueryData.rows.length === 0 || !aprvLineTypeSqlQueryData.rows[0].aprv_user_query) {
                    return res.status(400).json({ message: 'InvalidQuery' });
                }
                const selectedSqlQuery = {
                    text: aprvLineTypeSqlQueryData.rows[0].aprv_user_query,
                };
                const selectedSqlQueryData = await postgresql.query(selectedSqlQuery);
                const result =  selectedSqlQueryData.rows;
                const aprvList=extractUids(result)
                let groupName = '';
                // if (next_ag_num !== -1) {
                const { rows: groupNameRows } = await postgresql.query(queries.selectGroupNameByNextAgNum, [ag_num]);
                groupName = groupNameRows.length > 0 ? groupNameRows[0].group_name : '';
                // }

                // 라우트 삽입
                await postgresql.query(queries.insertRoute, [
                    mis_id, ag_num, activity, null, aprvIdValue, '', 0, null, 0, '', auth_id,
                    aprv_user_type, return_ag_num, next_ag_num, verify_query, aprv_user_query, aprv_skip, skip_query, aprvList,groupName
                ]);
            }



        }

        // 트랜잭션 커밋
        await postgresql.query('COMMIT');
        res.status(201).send({ message: 'Data inserted successfully', mis_id });
    } catch (err) {
        console.error('Error during transaction:', err);
        await postgresql.query('ROLLBACK');
        res.status(500).send('An error occurred during the transaction.');
    }
});
// 결재선 내 결제 그룹 제외 수정 및 저장
app.post('/test/updateAprv/:def_id', (req, res) => {
    const {def_id} = req.params; // URL에서 def_id 추출
    const {line_name, range_group} = req.body; // 요청 본문에서 각 컬럼 데이터 추출

    // SQL UPDATE 쿼리
    const query = `
        UPDATE scc_aprv_default
        SET line_name   = $2,
            range_group = $3,
            update_dt   = CURRENT_TIMESTAMP
        WHERE def_id = $1 RETURNING def_id;
    `;

    try {
        // PostgreSQL에 데이터 업데이트
        postgresql.query(query, [def_id, line_name, range_group]);
        // 업데이트된 그룹 ID 반환
        res.status(200).json({
            message: 'Group data successfully updated',
            // data: result.rows[0] // 반환된 결과의 첫 번째 row (def_id 포함)
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({
            message: 'Server error while updating group data',
            error: err.message
        });
    }
});


app.get('/test/getSccUser', async (req, res) => {
    const query = {
        text: `SELECT u.uid, u.uname FROM scc_user u`
    };

    try {
        const { rows } = await postgresql.query(query);

        // rows를 객체로 변환
        const result = rows.reduce((acc, row) => {
            acc[row.uid] = row.uname;
            return acc;
        }, {});

        res.status(200).json(result); // 변환된 객체를 응답
    } catch (error) {
        console.error('Error fetching approval default:', error);
        res.status(500).send('Internal Server Error');
    }
});

// 결재선 컨펌 데이트 업데이트
app.post('/test/updateConfirmDate', (req, res) => {
    const {mis_id} = req.body; // 요청 본문에서 mis_id 추출

    // SQL UPDATE 쿼리
    const query = `
        UPDATE scc_aprv_process
        SET confirm_dt = CURRENT_TIMESTAMP
        WHERE mis_id = $1 RETURNING mis_id;
    `;

    try {
        // PostgreSQL에 데이터 업데이트
        postgresql.query(query, [mis_id], (err, result) => {
            if (err) {
                console.error(err.message);
                return res.status(500).json({
                    message: 'Server error while updating confirm date',
                    error: err.message
                });
            }

            if (result.rowCount === 0) {
                return res.status(404).json({
                    message: 'No record found with the provided mis_id'
                });
            }

            // 업데이트된 mis_id 반환
            res.status(200).json({
                message: 'Confirm date successfully updated',
                data: result.rows[0] // 반환된 결과의 첫 번째 row (mis_id 포함)
            });
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({
            message: 'Server error while updating confirm date',
            error: err.message
        });
    }
});

// 결재선 추가 및 수정 시 결재선과 결재 그룹 저장 및 수정 하는 api
app.post('/test/updateOrInsertAprv/:def_id', async (req, res) => {
    const {def_id} = req.params;  // URL에서 def_id 추출
    const {line_name, range_group, gojs_data, line_depth, input_id} = req.body; // 요청 본문에서 필요한 데이터 추출

    // gojs_data 검증 (문자열이어야 함)
    if (typeof gojs_data !== 'string') {
        return res.status(400).json({message: "gojs_data must be a string"});
    }

    // gojs_data를 JSON 객체로 변환
    let converted_gojs_data;
    try {
        converted_gojs_data = JSON.stringify(JSON.parse(gojs_data));
    } catch (err) {
        console.error("Invalid JSON format for gojs_data", err);
        return res.status(400).json({message: "Invalid JSON format for gojs_data"});
    }

    // SQL 쿼리 정의
    const queries = {
        insertDefault: `
            INSERT INTO scc_aprv_default (range_group, line_name, line_depth, input_dt, gojs_data, input_id)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5) RETURNING def_id;
        `,
        updateDefault: `
            UPDATE scc_aprv_default
            SET line_name   = $2,
                range_group = $3,
                gojs_data   = $4,
                line_depth  = $5,
                update_dt   = CURRENT_TIMESTAMP
            WHERE def_id = $1 RETURNING def_id;
        `,
        insertGroup: `
            INSERT INTO scc_aprv_default_group (def_id, group_name, aprv_user_type, aprv_group, aprv_user_query,
                                                auth_id, verify_query, aprv_skip, skip_query, return_ag_num,
                                                verify_query_sql, aprv_verify, key, ag_num)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                    nextval('seq_ag_num')) returning key, ag_num;
        `,
        updateGroupAgNum: `
            UPDATE scc_aprv_default_group
            SET key           = $1,
                return_ag_num = $2
            WHERE ag_num = $1;
        `,
        insertGroupOrder: `
            INSERT INTO scc_aprv_default_group_order (def_id, ag_num, next_ag_num)
            VALUES ($1, $2, $3);
        `,
        insertUser: `
            INSERT INTO scc_aprv_default_user (def_id, ag_num, aprv_id, default_check)
            VALUES ($1, $2, $3, $4) RETURNING *;
        `,
        selectGojsData: `
            SELECT gojs_data
            FROM scc_aprv_default
            WHERE def_id = $1;
        `,
        updateGojsData: `
            UPDATE scc_aprv_default
            SET gojs_data = $2,
                update_dt = CURRENT_TIMESTAMP
            WHERE def_id = $1;
        `,
    };

    // 트랜잭션 시작
    await postgresql.query('BEGIN');

    try {
        let defId;

        // 기존 데이터 업데이트 또는 신규 데이터 삽입
        if (def_id !== '0') {
            const updateResult = await postgresql.query(queries.updateDefault, [def_id, line_name, range_group, converted_gojs_data, line_depth]);
            if (updateResult.rowCount === 0) {
                await postgresql.query('ROLLBACK');
                return res.status(404).json({message: 'No record found with the given def_id'});
            }
            defId = updateResult.rows[0].def_id;
        } else {
            const insertResult = await postgresql.query(queries.insertDefault, [range_group, line_name, line_depth, converted_gojs_data, input_id]);
            defId = insertResult.rows[0].def_id;
        }

        // 기존 그룹, 그룹 순서 및 사용자 데이터 삭제
        await postgresql.query('DELETE FROM scc_aprv_default_group WHERE def_id = $1', [defId]);
        await postgresql.query('DELETE FROM scc_aprv_default_group_order WHERE def_id = $1', [defId]);
        await postgresql.query('DELETE FROM scc_aprv_default_user WHERE def_id = $1', [defId]);

        const convertAgNumKeySet = {};
        const convertedGojsDataJson = JSON.parse(converted_gojs_data);
        function removeString(input, target) {
            const regex = new RegExp(target, 'g'); // target 문자열을 찾기 위한 정규 표현식
            return input.replace(regex, ''); // target 문자열을 제거하고 남은 부분을 반환
        }
        // 노드 및 사용자 처리
        const nodes = convertedGojsDataJson.nodeDataArray.slice(1);
        for (const node of nodes) {
            const result = await postgresql.query(queries.insertGroup, [
                defId,
                node.group_name,
                node.aprv_user_type,
                node.aprv_group,
                removeString(node.aprv_user_query, 'select uid, uname from scc_user'),
                node.auth_id,
                node.verify_query,
                node.aprv_skip,
                node.skip_query,
                node.return_ag_num,
                node.verify_query_sql,
                node.aprv_verify,
                node.key, // 현재 프론트에서 사용하는 가짜 음수 ag_num
            ]);
            convertAgNumKeySet[result.rows[0].key] = result.rows[0].ag_num;

            // 결재자 정보 삽입
            if (node.aprv_user_type === 0 && node.selectedapprovals && node.selectedapprovals.length > 0) {
                for (const approval of node.selectedapprovals) {
                    const { aprv_id, default_check} = approval;
                    await postgresql.query(queries.insertUser, [defId, convertAgNumKeySet[node.ag_num], aprv_id, default_check]);
                }
            }
        }

        // 그룹 순서 삽입
        // 링크는 자르면 안된다. 0번 기억해야 뭐가 제일 첫번째인지 알 수 있다.
        for (const link of convertedGojsDataJson.linkDataArray) {
            await postgresql.query(queries.insertGroupOrder, [
                defId,
                convertAgNumKeySet[link.from] || link.from,
                convertAgNumKeySet[link.to]
            ]);
        }

        // 그룹 업데이트
        for (const node of nodes) {
            await postgresql.query(queries.updateGroupAgNum, [
                convertAgNumKeySet[node.key],
                node.return_ag_num === -1
                    ? -1
                    : (convertAgNumKeySet[node.return_ag_num] || null),
            ]);
        }

        // gojs_data 업데이트
        const result = await postgresql.query(queries.selectGojsData, [defId]);
        if (result.rowCount === 0) {
            throw new Error(`No gojs_data found for def_id ${defId}`);
        }

        let gojsData;
        try {
            gojsData = result.rows[0].gojs_data;
        } catch (err) {
            console.error('Invalid gojs_data format', err);
            throw new Error(`Invalid gojs_data format for def_id ${defId}`);
        }

        // linkDataArray 및 nodeDataArray 배열 업데이트
        gojsData.linkDataArray = gojsData.linkDataArray.map(link => ({
            ...link,
            from: convertAgNumKeySet[link.from] || link.from,
            to: convertAgNumKeySet[link.to] || link.to,
        }));

        gojsData.nodeDataArray = gojsData.nodeDataArray.map(node => ({
            ...node,
            key: convertAgNumKeySet[node.key] || node.key,
            ag_num: convertAgNumKeySet[node.ag_num] || node.ag_num,
            return_ag_num: node.return_ag_num === -1
                ? -1
                : (convertAgNumKeySet[node.return_ag_num] || null),
        }));

        const updatedGojsData = JSON.stringify(gojsData);
        await postgresql.query(queries.updateGojsData, [defId, updatedGojsData]);

        // 트랜잭션 커밋
        await postgresql.query('COMMIT');

        res.status(200).json({
            message: 'Approval line and groups successfully updated or inserted',
            def_id: defId
        });
    } catch (err) {
        // 에러 발생 시 롤백
        await postgresql.query('ROLLBACK');
        console.error('Error during transaction', err);
        res.status(500).json({
            message: 'Server error while updating or inserting approval line and groups',
            error: err.message
        });
    }
});

// 특정 결재선의 range_group column 중복 여부 확인 API
app.post('/test/checkRangeGroup', (req, res) => {
    const {range_group, def_id} = req.body;
    const query = {
        text: "SELECT COUNT(*) FROM scc_aprv_default WHERE range_group = $1 AND def_id != $2",
        values: [range_group, def_id],
    };

    postgresql.query(query, (err, data) => {
        if (err) {
            return res.status(500).json({message: 'Error checking range group'});
        } else {
            const count = parseInt(data.rows[0].count, 10);
            if (count > 0) {
                if (range_group === -1) {
                    return res.status(400).json({message: 'FULL_GROUP_DUPLICATE'});
                } else {
                    return res.status(400).json({message: 'GROUP_DUPLICATE'});
                }
            } else {
                return res.status(200).json({message: 'Range group is valid'});
            }
        }
    });
});

// 결재선 삭제
app.delete('/test/deleteDefault/:def_id', async (req, res) => {
    const {def_id} = req.params;

    try {
        const result = await deleteDefaultFromDatabase(def_id);
        if (result.rowCount === 0) {
            return res.status(404).send('No record found with the given def_id.');
        }
        res.status(200).send({message: 'Data deleted successfully.'});
    } catch (error) {
        console.error(error);
        res.status(500).send('Error occurred while deleting from the database.');
    }
});

const deleteDefaultFromDatabase = async (def_id) => {
    // 먼저 scc_aprv_default_group 테이블에서 연결된 데이터를 삭제
    const deleteGroupQuery = {
        text: `DELETE
               FROM scc_aprv_default_group
               WHERE def_id = $1`,
        values: [def_id],
    };

    // 그 후 scc_aprv_default 테이블에서 데이터를 삭제
    const deleteDefaultQuery = {
        text: `DELETE
               FROM scc_aprv_default
               WHERE def_id = $1`,
        values: [def_id],
    };

    return new Promise((resolve, reject) => {
        postgresql.query(deleteGroupQuery, (err, result) => {
            if (err) return reject(err);

            postgresql.query(deleteDefaultQuery, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    });
};

// 결재 그룹 내 결재자 get api
app.post('/test/checkUserByAgNum', async (req, res) => {
    const { def_id, ag_num } = req.body;

    // aprv_user_type을 가져오는 쿼리
    const queryTypeQuery = {
        text: `SELECT ag_num, def_id, aprv_user_type
               FROM scc_aprv_default_group
               WHERE ag_num = $1
                 AND def_id = $2`,
        values: [ag_num, def_id],
    };

    // aprv_user_type이 0일 때 사용할 쿼리
    const aprvTypeQuery = {
        text: "SELECT du.*, u.uname FROM scc_aprv_default_user du JOIN scc_user u ON du.aprv_id = u.uid WHERE def_id = $1 AND ag_num = $2",
        values: [def_id, ag_num],
    };

    // aprv_user_type이 1일 때 사용할 쿼리
    const groupTypeQuery = {
        text: `SELECT ug.uid as aprv_id,
                      udg.auth_id,
                      udg.ag_num,
                      udg.aprv_user_type,
                      udg.skip_query,
                      udg.return_ag_num,
                      u.uname
               FROM scc_user_groups ug
                        JOIN scc_aprv_default_group udg ON ug.gid = udg.aprv_group
                        JOIN scc_user u ON ug.uid = u.uid
               WHERE udg.def_id = $1
                 AND udg.ag_num = $2`,
        values: [def_id, ag_num],
    };

    const aprvLineTypeSqlQuery = {
        text: `SELECT udg.auth_id,
                      udg.ag_num,
                      udg.aprv_user_type,
                      udg.skip_query,
                      udg.return_ag_num,
                      udg.aprv_user_query
               FROM scc_aprv_default_group udg
               WHERE udg.def_id = $1
                 AND udg.ag_num = $2`,
        values: [def_id, ag_num],
    };

    try {
        const typeData = await postgresql.query(queryTypeQuery);
        if (typeData.rows.length === 0) {
            return res.status(404).json({ message: 'No matching group found' });
        }

        const { aprv_user_type } = typeData.rows[0];

        if (aprv_user_type === 0) {
            // aprv_user_type이 0일 때
            const aprvTypeData = await postgresql.query(aprvTypeQuery);
            const aprvTypeNextAprv = aprvTypeData.rows.length > 0
                ? aprvTypeData.rows.sort((a, b) => b.default_check - a.default_check)
                : [];
            return res.status(200).json({ res: aprvTypeNextAprv });

        } else if (aprv_user_type === 1) {
            // aprv_user_type이 1일 때
            const groupTypeData = await postgresql.query(groupTypeQuery);
            const groupTypeNextAprv = groupTypeData.rows.length > 0 ? groupTypeData.rows : [];
            return res.status(200).json({ res: groupTypeNextAprv });

        } else if (aprv_user_type === 2) {
            // aprv_user_type이 2일 때
            const aprvLineTypeSqlQueryData = await postgresql.query(aprvLineTypeSqlQuery);
            if (aprvLineTypeSqlQueryData.rows.length === 0 || !aprvLineTypeSqlQueryData.rows[0].aprv_user_query) {
                return res.status(400).json({ message: 'InvalidQuery' });
            }

            const selectedSqlQuery = {
                text: aprvLineTypeSqlQueryData.rows[0].aprv_user_query,
            };

            const selectedSqlQueryData = await postgresql.query(selectedSqlQuery);

            const convertUidToAprvId = (array) => array.map(({ uid, ...rest }) => ({
                aprv_id: uid,
                ...rest,
            }));

            const result = convertUidToAprvId(selectedSqlQueryData.rows);
            return res.status(200).json({ res: result });

        } else {
            return res.status(400).json({ message: 'Invalid aprv_user_type' });
        }
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ message: error });
    }
});

// 로그인된 사용자 id로 생성된 결재선에서 결재선 정보와 결재선 내 한 그룹의 결재자 리스트 가져오는 api
app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {
    const uid = req.params.uid;

    const queries = {
        aprvLineSelect: {
            text: `
                SELECT * 
                FROM scc_aprv_default 
                WHERE range_group IN (
                    SELECT gid 
                    FROM scc_user_groups 
                    WHERE uid = $1
                ) 
                ORDER BY def_id DESC LIMIT 1
            `,
            values: [uid],
        },
        allAprvLineSelect: {
            text: `
                SELECT * 
                FROM scc_aprv_default 
                WHERE range_group = -1
            `,
        },
        aprvLineTypeAprv: (defId) => ({
            text: `
                SELECT 
                    u.aprv_id, u.ag_num, u.default_check, 
                    g.group_name, g.aprv_user_type, g.auth_id, g.skip_query, g.return_ag_num, 
                    su.uname 
                FROM 
                    scc_aprv_default_user u 
                JOIN 
                    scc_aprv_default_group g ON u.ag_num = g.ag_num 
                JOIN 
                    scc_user su ON u.aprv_id = su.uid 
                WHERE 
                    u.def_id = $1 
                AND 
                    u.ag_num = (
                        SELECT g_order.next_ag_num 
                        FROM scc_aprv_default_group_order g_order 
                        WHERE def_id = $1 AND ag_num = 0
                    )
            `,
            values: [defId],
        }),
        aprvLineTypeGroup: (defId) => ({
            text: `
                SELECT 
                    u.uid AS aprv_id, u.uname 
                FROM 
                    scc_user_groups ug 
                JOIN 
                    scc_aprv_default_group udg ON ug.gid = udg.aprv_group 
                JOIN 
                    scc_user u ON ug.uid = u.uid 
                WHERE 
                    udg.def_id = $1 
                AND 
                    udg.ag_num = (
                        SELECT g_order.next_ag_num 
                        FROM scc_aprv_default_group_order g_order 
                        WHERE def_id = $1 AND ag_num = 0
                    )
            `,
            values: [defId],
        }),
        aprvLineTypeSql: (defId) => ({
            text: `
                SELECT 
                    udg.auth_id, udg.ag_num, udg.aprv_user_type, 
                    udg.skip_query, udg.return_ag_num, udg.aprv_user_query 
                FROM 
                    scc_aprv_default_group udg 
                WHERE 
                    udg.def_id = $1 
                AND 
                    udg.ag_num = (
                        SELECT g_order.next_ag_num 
                        FROM scc_aprv_default_group_order g_order 
                        WHERE def_id = $1 AND ag_num = 0
                    )
            `,
            values: [defId],
        }),
    };

    try {
        const aprvLineData = await postgresql.query(queries.aprvLineSelect);
        const data = aprvLineData.rows.length ? aprvLineData : await postgresql.query(queries.allAprvLineSelect);

        if (!data.rows.length) {
            return res.status(404).send("결재선이 존재하지 않습니다.");
        }

        const defId = data.rows[0].def_id;

        // Execute Type 1 Query
        const typeAprvData = await postgresql.query(queries.aprvLineTypeAprv(defId));
        if (typeAprvData.rows.length > 0) {
            const sortedApprovals = typeAprvData.rows.sort((a, b) => b.default_check - a.default_check);
            return res.send({ aprv_data: data.rows, approvals: sortedApprovals });
        }

        // Execute Type 2 Query
        const typeGroupData = await postgresql.query(queries.aprvLineTypeGroup(defId));
        if (typeGroupData.rows.length > 0) {
            return res.send({ aprv_data: data.rows, approvals: typeGroupData.rows });
        }

        // Execute Type 3 Query
        const sqlData = await postgresql.query(queries.aprvLineTypeSql(defId));
        if (sqlData.rows.length > 0) {
            const { aprv_user_query, ...metaData } = sqlData.rows[0];
            const customQuery = await postgresql.query({ text: aprv_user_query });

            const result = customQuery.rows.map(row => ({
                ...row,
                ...metaData,
                aprv_id: row.uid,
            }));

            return res.send({ aprv_data: data.rows, approvals: result });
        }

        res.status(404).send("결재선에 대한 추가 정보가 없습니다.");
    } catch (error) {
        console.error(error);
        res.status(500).send("결재선 정보를 가져오는 중 오류가 발생했습니다.");
    }
});
// 로그인된 사용자 id와 결재선 상태로 결재선 가져오는 api
app.get('/test/aprvProcessExtractByInputAndStatus/:input_id/:status', async (req, res) => {
    const inputId = req.params.input_id;
    const status = req.params.status;

    const query = {
        text: `
            SELECT *
            FROM scc_aprv_process
            WHERE input_id = $1
              AND (status = $2 OR ($2 = 1 AND status IN (0, 1)))
        `,
        values: [inputId, status],
    };

    try {
        const data = await postgresql.query(query);

        // 데이터가 없을 경우 빈 배열 반환
        if (data.rows.length === 0) {
            return res.send({
                res: []
            });
        }

        // 쿼리 결과를 반환
        res.send({
            res: data.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval process.");
    }
});

// 특정 mis_id의 라우트 가져오는 api
app.get('/test/getApprovalRoute/:mis_id', async (req, res) => {

    const mis_id = req.params.mis_id; // URL 파라미터로부터 mis_id를 가져옵니다.

    // scc_aprv_route 테이블에서 mis_id를 조건으로 데이터를 조회하고 seq 오름차순으로 정렬하는 쿼리 작성
    // distinct
    const query = {
        text: `
            SELECT  mis_id, activity, activity_dt, aprv_id, opinion, delegated, delegator, necessary,
                alarm_send_result, auth_id, verify_query, aprv_user_type, aprv_user_list, aprv_user_query, skip_check,
                skip_query, ag_num, aprv_confirm, return_ag_num, group_name
            FROM scc_aprv_route
            WHERE mis_id = $1
--             ORDER BY seq ASC
        `,
        values: [mis_id], // 첫 번째 파라미터로 mis_id 값을 넣습니다.
    };

    try {
        // 쿼리 실행
        const data = await postgresql.query(query);

        // 데이터가 없을 경우 404 응답
        if (data.rows.length === 0) {
            return res.status(404).send("Approval route not found.");
        }

        // 조회된 데이터를 클라이언트에게 반환
        res.send({
            res: data.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval route.");
    }
});

// 결재자가 할당되지 않은 다음 라우트 가져오는 api
app.post('/test/getRoute', async (req, res) => {
    const {mis_id, next_ag_num} = req.body;
    const query = {
        text: `
            select *
            from scc_aprv_route r
            WHERE r.mis_id = $1
              AND r.ag_num = $2 AND (r.aprv_id IS NULL OR r.aprv_id = '')
        `,
        values: [mis_id, next_ag_num],
    };


    try {
        // 쿼리 실행
        const data = await postgresql.query(query);

        // 데이터가 없을 경우 404 응답
        if (data.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // 조회된 데이터를 클라이언트에게 반환
        res.send({
            res: data.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval route.");
    }
});

// 특정 aprv_id, mis_id의 activity가 1(결순번)인 라우트 가져오는 api
app.post('/test/getRouteByAprvIdAndMisIdAndActivity1', async (req, res) => {
    const {user_id, mis_id} = req.body;
    const query = {
        // 결 순번인 라우트 중에서, 선택된 라우트의 ag_num을 next_ag_num으로 가진, 즉 이전 결재 그룹이 결재가 안된 상태라면 배제하고 가져오도록 쿼리 제작
        text:`
            select r.group_name, r.ag_num, r.next_ag_num, r.activity, r.aprv_id, r.return_ag_num
            from scc_aprv_route r
            where  r.aprv_id = $1 and r.mis_id = $2
              and r.activity = 1
        `,
//         // phind
//         text:`
//             WITH cte_initial AS (
//                 -- 1. 초기 조건을 만족하는 행들을 가져옵니다.
//                 -- aprv_id와 mis_id가 주어진 값이고 activity가 1인 행만 선택합니다.
//                 SELECT r.group_name, r.ag_num, r.next_ag_num, r.activity, r.aprv_id, r.return_ag_num
//                 FROM scc_aprv_route r
//                 WHERE r.aprv_id = $1 AND r.mis_id = $2 AND r.activity = 1
//             ),
//                  cte_check AS (
//                      -- 2. cte_initial의 ag_num을 기준으로
//                      -- scc_aprv_route 테이블에서 next_ag_num이 같은 행들을 찾습니다.
//                      -- 이 중 activity가 3이 아닌 경우만 선택합니다.
//                      SELECT DISTINCT r.ag_num
//                      FROM scc_aprv_route r
//                               JOIN cte_initial ci ON r.next_ag_num = ci.ag_num
//                      WHERE r.activity != 3
//                 )
//             -- 3. cte_check에 포함되지 않은 cte_initial의 행만 반환합니다.
// -- 즉, 연결된 행들의 activity가 모두 3인 경우에만 cte_initial의 행을 유지합니다.
//             SELECT *
//             FROM cte_initial
//             WHERE ag_num NOT IN (SELECT ag_num FROM cte_check);
//         `,


        // 세윤 주임님
        // text:`
        //     select r.group_name, r.ag_num, r.next_ag_num, r.activity, r.aprv_id, r.return_ag_num
        //     from scc_aprv_route r
        //     where r.mis_id = $2
        //       and r.activity = 1 and r.aprv_id = $1
        //       and not exists (
        //         select 1
        //         from scc_aprv_route r1
        //                  join scc_aprv_route r2
        //                       on   r1.mis_id = r2.mis_id
        //                           and r1.next_ag_num = r2.ag_num
        //         where r1.activity != 3
        //          and r.mis_id = r1.mis_id
        //          and r.ag_num = r1.next_ag_num
        //          and r.activity = r2.activity
        //     )
        // `,
        values: [user_id, mis_id],
    };

    try {
        // 데이터는 하나 이상의 요소를 가진 배열로 나올수 있다
        const data = await postgresql.query(query);

        // 데이터가 없을 경우 빈 배열 반환
        if (data.rows.length === 0) {
            return res.send({
                rows: []
            });
        }
        
        res.send({
            rows: data.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval process and route.");
    }
})

// 특정 aprv_id, mis_id의 결재 대상 라우트 가져오는 api
app.post('/test/getRouteByAprvIdAndMisId', async (req, res) => {
    const {user_id, mis_id} = req.body;

    // activity가 1번 또는 3번인 것을 가져오되
    // activity가 3번이면서 다른 결재 그룹에 결재자 배정도 한 라우트는 가져오지 않도록 한다
    // activity가 1번인 경우는 해당 row의 ag_num을 next_ag_num으로 가진 row들을 조회하고, 해당 row들의 activity가
    // 3인 경우만 가져오로록 조건을 추가한 쿼리로 수정

    const query = {
        // 원래
        text: `
            SELECT *
            FROM scc_aprv_route r
            WHERE r.aprv_id = $1
              AND r.mis_id = $2
                AND r.activity in (1,3)
        `,
        // text: `
        //     SELECT *
        //     FROM scc_aprv_route r
        //     WHERE r.aprv_id = $1
        //       AND r.mis_id = $2
        //       AND r.activity = 1 or (r.activity = 3 and NOT EXISTS (
        //         SELECT 1
        //         FROM scc_aprv_route r2
        //         WHERE r2.ag_num = r.next_ag_num
        //           AND (r2.aprv_id IS NOT NULL)
        //     ))
        // `,
        // 도전
        // text: `
        //     WITH base_query AS (
        //         SELECT *
        //         FROM scc_aprv_route r
        //         WHERE r.aprv_id = $1
        //           AND r.mis_id = $2
        //           AND r.activity IN (1,3)
        //     )
        //     -- activity가 3인 경우에 대한 조건 추가
        //     SELECT *
        //     FROM base_query b
        //     WHERE b.activity = 1
        //        OR (
        //         b.activity = 3
        //             AND NOT EXISTS (
        //             SELECT 1
        //             FROM scc_aprv_route r2
        //             WHERE r2.ag_num = b.next_ag_num
        //               AND r2.aprv_id IS NOT NULL
        //         )
        //         )
        // `,
        // text: `
        //     SELECT *
        //     FROM scc_aprv_route r
        //     WHERE r.aprv_id = $1
        //       AND r.mis_id = $2
        //       AND r.activity IN (1, 3)
        //       AND (
        //         r.activity != 3 OR NOT EXISTS (
        //           SELECT 1
        //           FROM scc_aprv_route r2
        //           WHERE r2.ag_num = r.next_ag_num
        //             AND (r2.aprv_id IS NOT NULL)
        //       )
        //         )
        // `,
        // text:`
        //     SELECT *
        //     FROM scc_aprv_route r
        //     WHERE r.aprv_id =$1
        //       AND r.mis_id = $2
        //       AND r.activity IN (1, 3)
        //       AND (
        //         -- activity = 3 조건
        //         (r.activity = 3 AND NOT EXISTS (
        //           SELECT 1
        //           FROM scc_aprv_route r2
        //           WHERE r2.ag_num = r.next_ag_num
        //             AND (r2.aprv_id IS NOT NULL AND r2.aprv_id != '')
        //         ))
        //         OR
        //         -- activity = 1 조건
        //         (r.activity = 1 AND NOT EXISTS (
        //           SELECT 1
        //           FROM scc_aprv_route r3
        //           WHERE r3.ag_num = r.ag_num
        //             AND r3.activity != 3
        //         )
        //         AND NOT EXISTS (
        //           SELECT 1
        //           FROM scc_aprv_route r4
        //           WHERE r4.next_ag_num = r.ag_num
        //             AND r4.activity = 1
        //         ))
        //       );
        // `,
        values: [user_id, mis_id],
    };

    try {
        const data = await postgresql.query(query);

        // 한 프로세스의 라우트들에서, 라우트 여러개가 결재자가 같고 activity가 결재인 것을 가져와 결재가 안된 동일한 사용자의 route를 가져와야한다.

        //data에서 activity가 3번인 row의 next_ag_num을 scc_aprv_route 테이블의 다른 row의 ag_num이 갖고있고, 해당 row의 aprv_id가 ''가 아닌 경우, rows에 반환하지 않도록 해줘


        // 데이터가 없을 경우 빈 배열 반환
        if (data.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // 쿼리 결과를 반환
        // 여기서 쓰는 api는 1가지 row만 가져와야한다. 현재 결재할 것. 결재를 완료하고, 다음 결재자까지 배정된 것을 가져오면 안된다.
        res.send({
            rows: data.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval process and route.");
    }
})

// 다음 결재자 할당시 사용하는 라우트를 불러오는 api
// app.post('/test/getRouteForNextAprv', async (req, res) => {
//     const { mis_id, user_id } = req.body;
//
//     // scc_aprv_route에서 mis_id, user_id, activity가 3인 row를 찾아냄
//     const firstQuery = {
//         text: `
//             SELECT r.next_ag_num FROM scc_aprv_route r
//             WHERE r.mis_id = $1 AND r.aprv_id = $2 AND r.activity = 3
//         `,
//         values: [mis_id, user_id],
//     };
//
//     try {
//         // 첫 번째 쿼리 실행
//         const firstResult = await postgresql.query(firstQuery);
//
//         // 데이터가 없을 경우 빈 배열 반환
//         if (firstResult.rows.length === 0) {
//             return res.send({
//                 rows: []
//             });
//         }
//
//         // next_ag_num 값을 가져옴
//         const nextAgNum = firstResult.rows[0].next_ag_num;
//
//         // next_ag_num 값을 ag_num으로 갖고 있는, activity가 1인 row를 조회
//         const secondQuery = {
//             text: `
//                 SELECT r.* FROM scc_aprv_route r
//                 WHERE r.mis_id = $1 AND r.ag_num = $2 AND r.activity = 1 AND r.aprv_id IS NULL
//             `,
//             values: [mis_id, nextAgNum],
//         };
//
//         const secondResult = await postgresql.query(secondQuery);
//
//         // 데이터가 없을 경우 빈 배열 반환
//         if (secondResult.rows.length === 0) {
//             return res.send({
//                 rows: []
//             });
//         }
//
//         // 최종 결과 반환
//         res.send({
//             rows: secondResult.rows
//         });
//
//     } catch (err) {
//         console.error(err);
//         res.status(500).send("Error occurred while fetching approval process and route.");
//     }
// });

app.post('/test/getRouteForNextAprv', async (req, res) => {
    const { mis_id, user_id } = req.body;

    // scc_aprv_route에서 mis_id, user_id, activity가 3인 row를 찾아냄
    const firstQuery = {
        text: `
            SELECT r.next_ag_num FROM scc_aprv_route r
            WHERE r.mis_id = $1 AND r.aprv_id = $2 AND r.activity = 3
        `,
        values: [mis_id, user_id],
    };

    try {
        // 첫 번째 쿼리 실행
        const firstResult = await postgresql.query(firstQuery);


        // 데이터가 없을 경우 빈 배열 반환
        if (firstResult.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // next_ag_num 값 배열 생성
        const nextAgNums = firstResult.rows.map(row => row.next_ag_num);


        // next_ag_num 배열을 기반으로 두 번째 쿼리를 병렬로 실행
        const secondResults = await Promise.all(
            nextAgNums.map(async (nextAgNum) => {
                const secondQuery = {
                    text: `
                        SELECT r.* FROM scc_aprv_route r
                        WHERE r.mis_id = $1 AND r.ag_num = $2 AND r.activity = 1 AND r.aprv_id IS NULL
                    `,
                    values: [mis_id, nextAgNum],
                };

                const result = await postgresql.query(secondQuery);
                return result.rows; // 각 next_ag_num에 대한 결과 반환
            })
        );

        // 병렬 실행 결과를 평탄화하여 하나의 배열로 반환
        const flattenedResults = secondResults.flat();

        // 최종 결과 반환
        res.send({
            rows: flattenedResults,
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval process and route.");
    }
});


// 현재 사용자 정보를 받아와 다음 결
app.post('/test/getRouteForNextAprvByMis_idAndUser_idAndAg_num', async (req, res)=>{
    const { mis_id, user_id,ag_num } = req.body;

    // scc_aprv_route에서 mis_id, user_id, activity가 3인 row를 찾아냄
    const firstQuery = {
        text: `
            SELECT r.next_ag_num FROM scc_aprv_route r
            WHERE r.mis_id = $1 AND r.aprv_id = $2 AND r.ag_num = $3
        `,
        values: [mis_id, user_id,ag_num],
    };

    try {
        // 첫 번째 쿼리 실행
        const firstResult = await postgresql.query(firstQuery);


        // 데이터가 없을 경우 빈 배열 반환
        if (firstResult.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // next_ag_num 값 배열 생성
        const nextAgNums = firstResult.rows.map(row => row.next_ag_num);

        console.log(nextAgNums)
        // next_ag_num 배열을 기반으로 두 번째 쿼리를 병렬로 실행
        const secondResults = await Promise.all(
            nextAgNums.map(async (nextAgNum) => {
                const secondQuery = {
                    text: `
                        SELECT r.* FROM scc_aprv_route r
                        WHERE r.mis_id = $1 AND r.ag_num = $2 AND r.activity = 2 AND r.aprv_id IS NULL
                    `,
                    values: [mis_id, nextAgNum],
                };

                const result = await postgresql.query(secondQuery);
                return result.rows; // 각 next_ag_num에 대한 결과 반환
            })
        );

        // 병렬 실행 결과를 평탄화하여 하나의 배열로 반환
        const flattenedResults = secondResults.flat();

        // 최종 결과 반환
        res.send({
            rows: flattenedResults,
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval process and route.");
    }

})


// app.post('/test/getApprovalByAprvIdAndMisId', async (req, res) => {
//     const { user_id, mis_id } = req.body;
//
//     // 기본 쿼리: aprv_id와 mis_id로 데이터 조회
//     const query = {
//         text: `
//             SELECT *
//             FROM scc_aprv_route r
//             WHERE r.aprv_id = $1
//               AND r.mis_id = $2
//         `,
//         values: [user_id, mis_id],
//     };
//
//     try {
//         // 기본 데이터 조회
//         const data = await postgresql.query(query);
//
//         // 데이터가 없을 경우 빈 배열 반환
//         if (data.rows.length === 0) {
//             return res.send({
//                 rows: []
//             });
//         }
//
//         // activity가 3인 행들의 next_ag_num 추출
//         const nextAgNums = data.rows
//             .filter(row => row.activity === 3)
//             .map(row => row.next_ag_num);
//
//         if (nextAgNums.length > 0) {
//             // next_ag_num에 해당하는 행을 전역적으로 조회
//             const exclusionQuery = {
//                 text: `
//                     SELECT ag_num
//                     FROM scc_aprv_route
//                     WHERE ag_num = ANY($1)
//                       AND (aprv_id IS NOT NULL AND aprv_id != '');
//                 `,
//                 values: [nextAgNums],
//             };
//
//             const exclusionData = await postgresql.query(exclusionQuery);
//
//             // 제외할 ag_num 목록 추출
//             const excludedAgNums = exclusionData.rows.map(row => row.ag_num);
//
//             // 제외 조건 적용
//             const filteredRows = data.rows.filter(row =>
//                 !(row.activity === 3 && excludedAgNums.includes(row.next_ag_num))
//             );
//
//             // 결과 반환
//             return res.send({
//                 rows: filteredRows,
//             });
//         }
//
//         // next_ag_num이 없으면 기존 데이터를 반환
//         res.send({
//             rows: data.rows,
//         });
//
//     } catch (err) {
//         console.error(err);
//         res.status(500).send("Error occurred while fetching approval process and route.");
//     }
// });

// 결재 확인 (사용자가 결재할 요청 보는 화면)
app.post('/test/aprvProcessExtractByAprvIdAndStatus', async (req, res) => {
    const {user_id, status} = req.body;

    // status 값에 따라 p.status와 r.activity 조건 설정
    let statusCondition;
    let activityCondition;

    if (status === 1) { // 결재 예정, 결재 진행
        statusCondition = `p.status in (0, 1)`;
    } else if (status === 2) { // 전체 결재 완료
        statusCondition = `p.status = 2`;
    } else if (status === 3) {  // 결재 반려
        statusCondition = `p.status = 3`;
    } else if (status === 4) {  // 결재 취소
        statusCondition = `p.status = 4`;
    }
    else {
        return res.status(400).send("Invalid status value.");
    }

    // 쿼리 작성
    const query = {
        text: `
            SELECT distinct p.*
            FROM scc_aprv_process p
                     JOIN scc_aprv_route r ON p.mis_id = r.mis_id
            WHERE r.aprv_id = $1
              AND ${statusCondition}
        `,
        values: [user_id],
    };

    try {
        const data = await postgresql.query(query);

        // 데이터가 없을 경우 빈 배열 반환
        if (data.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // 쿼리 결과를 반환
        res.send({
            rows: data.rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval process and route.");
    }
});

// 현재 route 결재 진행
app.post('/test/updateCurrentUserRoute', async (req, res) => {
    const { mis_id, ag_num, activity, user_id, opinion, return_ag_num, aprv_id,next_approval_id,next_ag_num } = req.body;
    console.log("next_ag_num : ", next_ag_num)
    console.log("next_ag_num : ", next_approval_id)

    const queries = {
        findCurrentRoute: `
            SELECT * FROM scc_aprv_route
            WHERE mis_id = $1 AND aprv_id = $2 AND ag_num = $3
        `,
        updateCurrentRoute: `
            UPDATE scc_aprv_route
            SET activity = $1, opinion = $2, activity_dt = CURRENT_TIMESTAMP
            WHERE mis_id = $3 AND aprv_id = $4 AND ag_num = $5 AND next_ag_num = $6 RETURNING *;
        `,
        recursiveRouteInit: `
            WITH RECURSIVE route_hierarchy AS (
                -- 초기 조건: ag_num과 return_ag_num을 기반으로 시작하는 row 선택
                SELECT
                    r1.ag_num,
                    r1.next_ag_num,
                    r1.return_ag_num,
                    r1.activity,
                    r1.ag_num AS target_ag_num,
                    r1.return_ag_num AS target_return_ag_num
                FROM
                    scc_aprv_route r1
                WHERE
                    r1.ag_num = $1 AND r1.return_ag_num = $2

                UNION ALL

                -- 이전 row의 next_ag_num이 현재 row의 ag_num과 일치하는 row를 순회
                SELECT
                    r2.ag_num,
                    r2.next_ag_num,
                    r2.return_ag_num,
                    r2.activity,
                    h.target_ag_num,
                    h.target_return_ag_num
                FROM
                    scc_aprv_route r2
                        INNER JOIN
                    route_hierarchy h ON r2.next_ag_num = h.ag_num
            )
-- activity 업데이트를 수행
            UPDATE scc_aprv_route AS sr
            SET activity = CASE
                -- 조건 1: 순회 중 return_ag_num이 target_return_ag_num과 일치하면 activity = 1
                               WHEN sr.ag_num = rh.target_return_ag_num THEN 1
                -- 조건 2: 조건이 일치하지 않으면 activity = 2
                               ELSE 2
                END
                FROM route_hierarchy AS rh
            WHERE sr.ag_num = rh.ag_num
              AND (
            -- 조건 1에 일치하면 순회 중단
                rh.ag_num = rh.target_return_ag_num
               OR rh.next_ag_num IS NOT NULL
                );
        `,
        insertReturnHistory: `
            INSERT INTO scc_aprv_return_history (mis_id, ag_num, return_ag_num, aprv_id, opinion, return_cnt, return_dt)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP);
        `,
        updateProcessStatus: `
            UPDATE scc_aprv_process
            SET status = $1, status_dt = CURRENT_TIMESTAMP
            WHERE mis_id = $2;
        `,
        updateCancelOpinion: `
            UPDATE scc_aprv_process
            SET cancel_opinion = $1 WHERE mis_id = $2;
        `,
        checkAllRoutesActivity: `
            SELECT COUNT(*)::INTEGER AS total_routes,
                   SUM(CASE WHEN activity = 3 THEN 1 ELSE 0 END)::INTEGER AS completed_routes
            FROM scc_aprv_route WHERE mis_id = $1;
        `,
        checkActivity4Exists: `
            SELECT COUNT(*)::INTEGER AS count
            FROM scc_aprv_route WHERE mis_id = $1 AND activity = 4;
        `,
        findNextRoute: `
            SELECT next_ag_num FROM scc_aprv_route
            WHERE mis_id = $1 AND ag_num = $2;
        `,
        updateNextRouteActivity:`
            UPDATE scc_aprv_route
            SET activity = 1, aprv_id  = $3
            WHERE mis_id = $1 AND ag_num = $2
        `
    };

    try {
        await postgresql.query('BEGIN');

        // currentRoute는 여러개 나올수 있다.
        const currentRoute = await postgresql.query(queries.findCurrentRoute, [mis_id, user_id, ag_num]);

        if (currentRoute.rowCount === 0) throw new Error('No matching route found for the current user.');

        if (activity === 4) {
            // 취소 처리
            await postgresql.query(queries.updateCurrentRoute, [activity, opinion, mis_id, user_id, ag_num, next_ag_num]);
            await postgresql.query(queries.recursiveRouteInit, [ag_num, return_ag_num]);
            await postgresql.query(queries.updateCancelOpinion, [opinion, mis_id]);
            await postgresql.query(queries.updateProcessStatus, [4, mis_id]);
        } else if (activity === 5) {
            // 반려 처리
            console.log('반려 처리')
            await postgresql.query(queries.updateCurrentRoute, [2, opinion, mis_id, user_id, ag_num, next_ag_num]);
            console.log('반려 라우트 업데이트')
            await postgresql.query(queries.recursiveRouteInit, [ag_num, return_ag_num]);
            console.log('관련 라우트 업데이트')
            await postgresql.query(queries.insertReturnHistory, [mis_id, ag_num, return_ag_num, aprv_id, opinion, 0]);
            await postgresql.query(queries.updateProcessStatus, [3, mis_id]);
        } else {
            // 일반 결재 처리
            await postgresql.query(queries.updateCurrentRoute, [activity, opinion, mis_id, user_id, ag_num, next_ag_num]);
        }

        // 상태 업데이트 및 라우터 확인
        const allRoutesStatus = await postgresql.query(queries.checkAllRoutesActivity, [mis_id]);
        const { total_routes, completed_routes } = allRoutesStatus.rows[0];
        const activity4Exists = await postgresql.query(queries.checkActivity4Exists, [mis_id]);

        // 작동 여부 확인
        // console.log("액티비티4 없음 : ",activity4Exists.rows[0].count)
        if (activity4Exists.rows[0].count === 0) {
            if (completed_routes === total_routes) {
                await postgresql.query(queries.updateProcessStatus, [2, mis_id]);
            }
            else if (activity === 3) {
                await postgresql.query(queries.updateProcessStatus, [1, mis_id]);
            }
        }
        // const nextRouteArr = await postgresql.query(queries.findNextRoute, [mis_id, ag_num]);
        // 1개 이상의 배열이 나올 수 있음
        // console.log(nextRouteArr)
        // if (nextRouteArr.rows.length > 0) {
        //     for (const route of nextRouteArr.rows) {
        //         const { next_ag_num } = route;
        //         // next_ag_num 값을 사용해 update 쿼리를 실행
        //         await postgresql.query(queries.updateNextRouteActivity, [mis_id, next_ag_num, next_approval_id]);
        //     }
        // }
        
        // 결재만 하는경우
        
        // 결재하고 다음 결재 그룹에 결재자 할당까지 하는 경우
        if(next_approval_id !== ''){
            await postgresql.query(queries.updateNextRouteActivity, [mis_id, next_ag_num, next_approval_id]);
        }
        await postgresql.query('COMMIT');

        res.status(200).json({
            message: 'Route successfully updated.',
            // isLastRoute: nextRoute.rowCount === 0,
        });
    } catch (error) {
        await postgresql.query('ROLLBACK');
        console.error('Error updating route:', error.message);
        res.status(500).json({
            message: 'Error updating route data.',
            error: error.message,
        });
    }
});

// 다음 route 결재 진행
app.post('/test/updateNextUserRoute',async (req, res)=>{

    const {  next_approval_id,mis_id, next_ag_num} = req.body; // 요청 본문에서 필요한 값들 추출


    const updateNextRouteQuery = `
        UPDATE scc_aprv_route
        SET activity = 1,
            aprv_id  = $1
        WHERE mis_id = $2 AND ag_num = $3   RETURNING *;
    `;

    try {
        await postgresql.query('BEGIN');

        await postgresql.query(updateNextRouteQuery, [next_approval_id, mis_id, next_ag_num]);
        await postgresql.query('COMMIT');

        res.status(200).json({
            message: '다음 결재자가 업데이트 됐습니다.',
        });
    } catch (err) {
        await postgresql.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({
            message: 'Server error while updating route data',
            error: err.message
        });
    }
})

// 동일한 next_ag_num이고 activity가 2(결재 대기)인 현 route를 제외한 다른 route 찾는 api
app.post('/test/getSameNextAgNumRoute',async (req, res)=>{
    const {mis_id, ag_num, next_ag_num} = req.body; // 요청 본문에서 필요한 값들 추출
    const getSameNextAgNumRouteQuery = `
        select * from  scc_aprv_route
        WHERE mis_id = $1 AND ag_num != $2
          AND next_ag_num = $3 AND activity = 1;
    `;
    try {
        await postgresql.query('BEGIN');
        const currentRouteResult = await postgresql.query(getSameNextAgNumRouteQuery, [mis_id,ag_num, next_ag_num]);
        await postgresql.query('COMMIT');

        if (currentRouteResult.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // 쿼리 결과를 반환
        res.send({
            rows: currentRouteResult.rows
        });
    }
    catch (err) {
        await postgresql.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({
            message: 'Server error while updating route data',
            error: err.message
        });
}})

// 현재 결재자의 ag_num을 next_ag_num으로 가진 아직 결재 안된 결재 그룹이 있는지 확인 하는 api
app.post('/test/getDirectedCurrentRouteNotAprv',async (req, res)=>{
    const {mis_id, ag_num} = req.body; // 요청 본문에서 필요한 값들 추출
    const getSameNextAgNumRouteQuery = `
        select * from  scc_aprv_route
        WHERE mis_id = $1 AND next_ag_num = $2 AND activity != 3;
    `;
    try {
        await postgresql.query('BEGIN');
        const currentRouteResult = await postgresql.query(getSameNextAgNumRouteQuery, [mis_id,ag_num]);
        await postgresql.query('COMMIT');

        if (currentRouteResult.rows.length === 0) {
            return res.send({
                rows: []
            });
        }

        // 쿼리 결과를 반환
        res.send({
            rows: currentRouteResult.rows
        });
    }
    catch (err) {
        await postgresql.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({
            message: 'Server error while updating route data',
            error: err.message
        });
    }})

// route 결재 진행. 현재 미사용하나 일단 삭제 보류
app.post('/test/updateRoute', async (req, res) => {
    const {mis_id, ag_num, activity, user_id, next_approval_id, opinion, next_ag_num} = req.body; // 요청 본문에서 필요한 값들 추출

    // SQL 쿼리 1: 현재 로그인한 사용자가 라우트 테이블에 있는지 확인하는 api
    const findCurrentRouteQuery = `
        SELECT *
        FROM scc_aprv_route
        WHERE mis_id = $1
          AND aprv_id = $2
          AND ag_num = $3
    `;

    // SQL 쿼리 2: 현재 라우트를 업데이트하는 쿼리 (activity, opinion, activity_dt 값 업데이트)
    const updateCurrentRouteQuery = `
        UPDATE scc_aprv_route
        SET activity    = $1,
            opinion     = $2,
            activity_dt = CURRENT_TIMESTAMP
        WHERE mis_id = $3
          AND aprv_id = $4
          AND ag_num = $5 RETURNING *;
    `;

    // SQL 쿼리 3: 다음 라우터를 찾는 쿼리
    const findNextRouteQuery = `
        SELECT *
        FROM scc_aprv_route
        WHERE mis_id = $1
          AND ag_num = $2
    `;

    // SQL 쿼리 4: 다음 라우트를 업데이트하는 쿼리. where에 별도의 조건이 필요하다. 결재자 타입과 그룹타입 모두 라우트의 고유한 키를
    const updateNextRouteQuery = `
        UPDATE scc_aprv_route
        SET activity = 1,
            aprv_id  = $1
        WHERE mis_id = $2
          AND ag_num = $3 RETURNING *;
    `;

    // SQL 쿼리 5: scc_aprv_process 테이블에서 status_dt 업데이트
    const updateProcessStatusDtQuery = `
        UPDATE scc_aprv_process
        SET status_dt = CURRENT_TIMESTAMP
        WHERE mis_id = $1
    `;

    // SQL 쿼리 6: scc_aprv_process 테이블의 cancel_opinion 칼럼 업데이트
    const updateProcessCancelOpinionQuery = `
        UPDATE scc_aprv_process
        SET cancel_opinion = $1
        WHERE mis_id = $2
    `;

    // SQL 쿼리 7: scc_aprv_process 테이블의 status 값 업데이트
    const updateProcessStatusValueQuery = `
        UPDATE scc_aprv_process
        SET status    = $1,
            status_dt = CURRENT_TIMESTAMP
        WHERE mis_id = $2
    `;

    // SQL 쿼리 8: 모든 route의 activity 상태 확인 후 전체 라우트 수와 결재 상태인 라우트 개수 반환
    const checkAllRoutesActivityQuery = `
        SELECT COUNT(*)::INTEGER as total_routes, SUM(CASE WHEN activity = 3 THEN 1 ELSE 0 END) ::INTEGER as completed_routes
        FROM scc_aprv_route
        WHERE mis_id = $1
    `;

    // SQL 쿼리 9: activity가 4인 row가 있는지 확인하는 쿼리
    const checkActivity4ExistsQuery = `
        SELECT COUNT(*) ::INTEGER as count
        FROM scc_aprv_route
        WHERE mis_id = $1 AND activity = 4
    `;

    try {
        await postgresql.query('BEGIN');

        // 현재 로그인한 사용자가 라우트 테이블에 있는지 확인
        const currentRouteResult = await postgresql.query(findCurrentRouteQuery, [mis_id, user_id, ag_num]);
        if (currentRouteResult.rowCount === 0) {
            throw new Error('No matching route found for the current user.');
        }

        // 현재 로그인한 사용자가 결재 취소하는 경우
        if (activity === 4) {
            // scc_aprv_route 테이블 업데이트
            await postgresql.query(updateCurrentRouteQuery, [activity, opinion, mis_id, user_id, ag_num]);

            // scc_aprv_process 테이블의 cancel_opinion에 opinion 값 저장
            await postgresql.query(updateProcessCancelOpinionQuery, [opinion, mis_id]);

            // scc_aprv_process 테이블의 status 값을 3(반려)으로 업데이트 (activity가 4인 경우)
            await postgresql.query(updateProcessStatusValueQuery, [3, mis_id]);
        } else {
            // 원인 예상 분기
            await postgresql.query(updateCurrentRouteQuery, [activity, opinion, mis_id, user_id, ag_num]);
        }

        // scc_aprv_process 테이블의 status_dt 업데이트
        await postgresql.query(updateProcessStatusDtQuery, [mis_id]);

        // 현재 process에 해당하는 모든 route의 상태 확인
        const allRoutesStatus = await postgresql.query(checkAllRoutesActivityQuery, [mis_id]);
        const {total_routes, completed_routes} = allRoutesStatus.rows[0];

        // activity가 4인 (route가 취소인) row가 있는지 확인
        const activity4Exists = await postgresql.query(checkActivity4ExistsQuery, [mis_id]);
        const hasActivity4 = activity4Exists.rows[0].count > 0;

        // if (!hasActivity4) {
        //     await postgresql.query(updateProcessStatusValueQuery, [1, mis_id]);
        // }

        if (!hasActivity4 && completed_routes === 1 && activity === 3) {
            await postgresql.query(updateProcessStatusValueQuery, [1, mis_id]);
        } else if (completed_routes === total_routes) {
            await postgresql.query(updateProcessStatusValueQuery, [2, mis_id]);
        }
        const nextRouteResult = await postgresql.query(findNextRouteQuery, [mis_id, next_ag_num]);

        if (nextRouteResult.rowCount === 0) {
            // 마지막 라우터일 경우
            await postgresql.query('COMMIT');
            return res.status(200).json({
                message: 'Current route updated, no next route available.',
                isLastRoute: true // 마지막 라우터임을 표시
            });
        }

        const nextRouteChangeResult = await postgresql.query(updateNextRouteQuery, [next_approval_id, mis_id, next_ag_num]);
        console.log("nextRouteChangeResult : ",nextRouteChangeResult)
        await postgresql.query('COMMIT');

        res.status(200).json({
            message: 'Current and next route successfully updated.',
            isLastRoute: false // 마지막 라우터 아님을 표시
        });
    } catch (err) {
        await postgresql.query('ROLLBACK');
        console.error(err.message);
        res.status(500).json({
            message: 'Server error while updating route data',
            error: err.message
        });
    }
});

// 사용 안하게 된 api
app.post('/test/getGroupByDefIdAndAgNum', async (req, res) => {
    const { def_id, ag_num } = req.body;

    // 현재 결재자의 ag_num을 가져와 다음 결재자를 찾는다
    const findNextAgNumQuery = {
        text: "SELECT g_order.next_ag_num FROM scc_aprv_default_group_order g_order WHERE g_order.def_id = $1 AND g_order.ag_num = $2",
        values: [def_id, ag_num],
    };

    try {
        const next_ag_num_data = await postgresql.query(findNextAgNumQuery);
        if (next_ag_num_data.rows.length === 0) {
            return res.status(200).json([]);
        }

        // 모든 next_ag_num에 대해 두 번째 쿼리 실행
        const results = await Promise.all(
            next_ag_num_data.rows.map(async (row) => {
                const nextAgNum = row.next_ag_num;

                const query = {
                    text: `SELECT g.* FROM scc_aprv_default_group g LEFT JOIN scc_aprv_route r ON g.ag_num = r.ag_num 
                            WHERE g.def_id = $1 AND g.ag_num = $2 AND (r.aprv_id IS NULL OR r.aprv_id = '')`,
                    values: [def_id, nextAgNum],
                };

                const result2 = await postgresql.query(query);
                return result2.rows; // 각 쿼리의 결과 반환
            })
        );

        // 결과를 평탄화(flatten)하여 클라이언트에 전달
        const flattenedResults = results.flat();
        res.status(200).json(flattenedResults.length > 0 ? flattenedResults : []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error processing request' });
    }
});
