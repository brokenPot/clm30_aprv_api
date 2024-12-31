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

// const HOST = '192.168.10.104'; // 로컬 IP 기본값
const HOST = '0.0.0.0'; // 서버 IP 기본값
const PORT = 8081;

//서버연결
server.listen(PORT, HOST, () => {
    postgresql.connect();
})

// 1. 결재선 전체 가져오는 api
app.get('/test/aprvDefault', async (req, res) => {
    const query = {
        text: `
            SELECT * 
            FROM scc_aprv_default 
            ORDER BY update_dt DESC, input_dt DESC
        `,
    };

    try {
        const {rows} = await postgresql.query(query); // async/await 사용으로 비동기 코드 처리
        res.status(200).json(rows); // rows를 바로 응답
    } catch (error) {
        console.error('Error fetching approval default:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/test/getAprvDefault/:def_id', async (req, res) => {
    const { def_id } = req.params; // URL 파라미터로 def_id 받기
    const selectDefaultQuery = {
        text: `SELECT def_id, line_name
               FROM scc_aprv_default
               WHERE range_group = $1`,
        values: [def_id], // 쿼리의 값 설정
    };

    try {
        // DB 조회 실행
        const { rows } = await postgresql.query(selectDefaultQuery);

        // 결과 반환 (데이터가 없을 경우 빈 배열 반환)
        res.status(200).json(rows.length > 0 ? rows : []);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error occurred while retrieving data from the database.');
    }
});


// 2. 프로세스 추가
app.post('/test/insertProcess', async (req, res) => {
    const { title, info, input_id, aprv_id, def_id } = req.body;

    const queries = {
        insertProcess: `
            INSERT INTO scc_aprv_process (title, info, status, del_flag, input_id, def_id, input_dt, module_name, status_dt, cancel_opinion, confirm_dt)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP)
                RETURNING mis_id;
        `,
        selectDefaultGroupByDefId: `
            SELECT g.ag_num, g.return_ag_num, g.aprv_user_type, g.auth_id, g.group_name, g.verify_query, g.skip_query, g.aprv_user_query, g.aprv_skip,
                   COALESCE(g_order.next_ag_num, -1) AS next_ag_num
            FROM scc_aprv_default_group g
                     LEFT JOIN scc_aprv_default_group_order g_order
                               ON g.def_id = g_order.def_id AND g.ag_num = g_order.ag_num
            WHERE g.def_id = $1;
        `,
        selectFirstAgNum: `
            SELECT next_ag_num
            FROM scc_aprv_default_group_order
            WHERE def_id = $1 AND ag_num = 0;
        `,
        selectGroupNameByNextAgNum: `
            SELECT group_name
            FROM scc_aprv_default_group
            WHERE ag_num = $1;
        `,
        insertRoute: `
            INSERT INTO scc_aprv_route (mis_id, ag_num, activity, activity_dt, aprv_id, opinion, delegated, delegator, necessary, alarm_send_result,
                                        auth_id, aprv_user_type, return_ag_num, next_ag_num, verify_query, aprv_user_query, skip_check, skip_query,
                                        aprv_user_list, group_name, read_dt, aprv_confirm)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, 0);
        `,
    };

    const fetchGroupName = async (ag_num) => {
        const { rows } = await postgresql.query(queries.selectGroupNameByNextAgNum, [ag_num]);
        return rows.length > 0 ? rows[0].group_name : '';
    };

    const fetchApprovers = async (query) => {
        const { rows } = await postgresql.query(query);
        return rows.map(row => row.uid).join(', ');
    };

    try {
        // 트랜잭션 시작
        await postgresql.query('BEGIN');

        // 1. scc_aprv_process 테이블에 데이터 삽입
        const { rows: processRows } = await postgresql.query(queries.insertProcess, [title, info, 0, 0, input_id, def_id]);
        const mis_id = processRows[0].mis_id;

        // 2. 결재선 id에 해당하는 결재 그룹 가져오기
        const { rows: routeGroups } = await postgresql.query(queries.selectDefaultGroupByDefId, [def_id]);

        // 첫 번째 ag_num 가져오기
        const { rows: firstAgRows } = await postgresql.query(queries.selectFirstAgNum, [def_id]);
        const first_ag_num = firstAgRows.length > 0 ? firstAgRows[0].next_ag_num : 0;

        // 3. 결재선 내 각 그룹 별로 라우트 데이터 생성 및 삽입
        for (const group of routeGroups) {
            const {
                ag_num, return_ag_num, aprv_user_type, auth_id, verify_query, skip_query,
                aprv_user_query, aprv_skip, next_ag_num,
            } = group;

            const activity = ag_num === first_ag_num ? 1 : 2;
            const aprvIdValue = ag_num === first_ag_num ? aprv_id : null;

            let aprvList = '';
            if (aprv_user_type === 0) {
                const aprvTypeQuery = {
                    text: "SELECT u.uid FROM scc_aprv_default_user du JOIN scc_user u ON du.aprv_id = u.uid WHERE def_id = $1 AND ag_num = $2",
                    values: [def_id, ag_num],
                };
                aprvList = await fetchApprovers(aprvTypeQuery);
            } else if (aprv_user_type === 1) {
                const groupTypeQuery = {
                    text: `
                        SELECT u.uid
                        FROM scc_user_groups ug
                                 JOIN scc_aprv_default_group udg ON ug.gid = udg.aprv_group
                                 JOIN scc_user u ON ug.uid = u.uid
                        WHERE udg.def_id = $1 AND udg.ag_num = $2
                    `,
                    values: [def_id, ag_num],
                };
                aprvList = await fetchApprovers(groupTypeQuery);
            } else if (aprv_user_type === 2) {
                const { rows: sqlQueryRows } = await postgresql.query({
                    text: aprv_user_query,
                });
                aprvList = sqlQueryRows.map(row => row.uid).join(', ');
            }

            const groupName = await fetchGroupName(ag_num);

            // 라우트 데이터 삽입
            await postgresql.query(queries.insertRoute, [
                mis_id, ag_num, activity, null, aprvIdValue, '', 0, null, 0, '', auth_id,
                aprv_user_type, return_ag_num, next_ag_num, verify_query, aprv_user_query, aprv_skip,
                skip_query, aprvList, groupName,
            ]);
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

// 3. scc_user 테이블 내 uid uname 해시 테이블 가져오는 api
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

// 4. 결재선 컨펌 데이트 업데이트 api
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

// 5. 결재선 추가 및 수정 시 결재선과 결재 그룹 저장 및 수정 하는 api
app.post('/test/updateOrInsertAprv/:def_id', async (req, res) => {
    const { def_id } = req.params;
    const { line_name, range_group, gojs_data, line_depth, input_id } = req.body;

    if (typeof gojs_data !== 'string') {
        return res.status(400).json({ message: "gojs_data must be a string" });
    }

    // gojs_data를 JSON 객체로 변환
    let convertedGojsData;
    try {
        convertedGojsData = JSON.stringify(JSON.parse(gojs_data));
    } catch (err) {
        console.error("Invalid JSON format for gojs_data", err);
        return res.status(400).json({ message: "Invalid JSON format for gojs_data" });
    }

    const queries = {
        insertDefault: `INSERT INTO scc_aprv_default (range_group, line_name, line_depth, input_dt, gojs_data, input_id)
                        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5) RETURNING def_id;`,
        updateDefault: `UPDATE scc_aprv_default
                        SET line_name = $2, range_group = $3, gojs_data = $4, line_depth = $5, update_dt = CURRENT_TIMESTAMP
                        WHERE def_id = $1 RETURNING def_id;`,
        // deleteRelatedData: `DELETE FROM scc_aprv_default_group WHERE def_id = $1;
        // DELETE FROM scc_aprv_default_group_order WHERE def_id = $1;
        // DELETE FROM scc_aprv_default_user WHERE def_id = $1;`,
        insertGroup: `INSERT INTO scc_aprv_default_group (def_id, group_name, aprv_user_type, aprv_group, aprv_user_query,
                                                          auth_id, verify_query, aprv_skip, skip_query, return_ag_num,
                                                          verify_query_sql, aprv_verify, key, ag_num)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, nextval('seq_ag_num')) RETURNING key, ag_num;`,
        updateGroupAgNum: `UPDATE scc_aprv_default_group SET key = $1, return_ag_num = $2 WHERE ag_num = $1;`,
        insertGroupOrder: `INSERT INTO scc_aprv_default_group_order (def_id, ag_num, next_ag_num) VALUES ($1, $2, $3);`,
        insertUser: `INSERT INTO scc_aprv_default_user (def_id, ag_num, aprv_id, default_check) VALUES ($1, $2, $3, $4);`,
        selectGojsData: `SELECT gojs_data FROM scc_aprv_default WHERE def_id = $1;`,
        updateGojsData: `UPDATE scc_aprv_default SET gojs_data = $2, update_dt = CURRENT_TIMESTAMP WHERE def_id = $1;`,
    };

    await postgresql.query('BEGIN');

    try {
        let defId;
        // 기존 데이터 업데이트 또는 신규 데이터 삽입
        if (def_id !== '0') {
            const updateResult = await postgresql.query(queries.updateDefault, [def_id, line_name, range_group, convertedGojsData, line_depth]);
            if (updateResult.rowCount === 0) {
                throw new Error('No record found with the given def_id');
            }
            defId = updateResult.rows[0].def_id;
        }
        // 수정
        else {
            const insertResult = await postgresql.query(queries.insertDefault, [range_group, line_name, line_depth, convertedGojsData, input_id]);
            defId = insertResult.rows[0].def_id;
        }

        // 기존 그룹, 그룹 순서 및 사용자 데이터 삭제
        // await postgresql.query(queries.deleteRelatedData, [defId]);
        // Error during transaction error: cannot insert multiple commands into a prepared statement
        await postgresql.query('DELETE FROM scc_aprv_default_group WHERE def_id = $1', [defId]);
        await postgresql.query('DELETE FROM scc_aprv_default_group_order WHERE def_id = $1', [defId]);
        await postgresql.query('DELETE FROM scc_aprv_default_user WHERE def_id = $1', [defId]);


        const convertAgNumKeySet = {};
        const parsedGojsData = JSON.parse(convertedGojsData);

        // 시작 그룹(노드) 자르기
        const nodes = parsedGojsData.nodeDataArray.slice(1);

        for (const node of nodes) {
            const groupResult = await postgresql.query(queries.insertGroup, [
                defId,
                node.group_name,
                node.aprv_user_type,
                node.aprv_group,
                node.aprv_user_query.replace(/select uid, uname from scc_user/g, ''),
                node.auth_id,
                node.verify_query,
                node.aprv_skip,
                node.skip_query,
                node.return_ag_num,
                node.verify_query_sql,
                node.aprv_verify,
                node.key
            ]);
            convertAgNumKeySet[groupResult.rows[0].key] = groupResult.rows[0].ag_num;

            // 결재자 정보 삽입
            if (node.aprv_user_type === 0 && Array.isArray(node.selectedapprovals)) {
                for (const approval of node.selectedapprovals) {
                    await postgresql.query(queries.insertUser, [defId, convertAgNumKeySet[node.key], approval.aprv_id, approval.default_check]);
                }
            }
        }

        // 결재 그룹의 순서 테이블에 삽입
        for (const link of parsedGojsData.linkDataArray) {
            await postgresql.query(queries.insertGroupOrder, [
                defId,
                convertAgNumKeySet[link.from] || link.from,
                convertAgNumKeySet[link.to] || link.to
            ]);
        }

        // 결재 그룹 테이블에 삽입
        for (const node of nodes) {
            await postgresql.query(queries.updateGroupAgNum, [
                convertAgNumKeySet[node.key],
                node.return_ag_num === -1
                    ? -1
                    : (convertAgNumKeySet[node.return_ag_num] || 0),
            ]);
        }

        // gojs_data 업데이트
        const gojsDataResult = await postgresql.query(queries.selectGojsData, [defId]);
        if (gojsDataResult.rowCount === 0) {
            throw new Error(`No gojs_data found for def_id ${defId}`);
        }

        let gojsData;
        try {
            gojsData = gojsDataResult.rows[0].gojs_data;
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
                : (convertAgNumKeySet[node.return_ag_num] || 0),
        }));
        await postgresql.query(queries.updateGojsData, [defId, JSON.stringify(gojsData)]);

        await postgresql.query('COMMIT');

        res.status(200).json({
            message: 'Approval line and groups successfully updated or inserted',
            def_id: defId
        });
    } catch (err) {
        await postgresql.query('ROLLBACK');
        console.error('Error during transaction', err);
        res.status(500).json({
            message: 'Server error while updating or inserting approval line and groups',
            error: err.message
        });
    }
});

// 6. 특정 결재선의 range_group column 중복 여부 확인 API
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

// 7. 결재선 삭제
app.delete('/test/deleteDefault/:def_id', async (req, res) => {
    const { def_id } = req.params;

    const deleteDefaultFromDatabase = async (def_id) => {
        try {
            // 삭제 전에 데이터를 조회
            const selectDefaultQuery = {
                text: `SELECT *
                       FROM scc_aprv_default
                       WHERE def_id = $1`,
                values: [def_id],
            };

            const selectGroupQuery = {
                text: `SELECT *
                       FROM scc_aprv_default_group
                       WHERE def_id = $1`,
                values: [def_id],
            };

            const defaultResult = await postgresql.query(selectDefaultQuery);
            const groupResult = await postgresql.query(selectGroupQuery);

            // 데이터가 없으면 종료
            if (defaultResult.rows.length === 0 && groupResult.rows.length === 0) {
                await postgresql.query('ROLLBACK');
                return { success: false, data: null };
            }

            // scc_aprv_default_group 테이블에서 데이터 삭제
            const deleteGroupQuery = {
                text: `DELETE
                       FROM scc_aprv_default_group
                       WHERE def_id = $1`,
                values: [def_id],
            };
            await postgresql.query(deleteGroupQuery);

            // scc_aprv_default 테이블에서 데이터 삭제
            const deleteDefaultQuery = {
                text: `DELETE
                       FROM scc_aprv_default
                       WHERE def_id = $1`,
                values: [def_id],
            };
            await postgresql.query(deleteDefaultQuery);

            await postgresql.query('COMMIT');

            return {
                success: true,
                data: {
                    deletedDefaults: defaultResult,
                    deletedGroups: groupResult.rows,
                },
            };
        } catch (err) {
            await postgresql.query('ROLLBACK');
            throw err;
        }
    };

    try {
        const result = await deleteDefaultFromDatabase(def_id);

        if (!result.success) {
            return res.status(404).send('No record found with the given def_id.');
        }

        res.status(200).send({
            message: 'Data deleted successfully.',
            deletedData: result.data.deletedDefaults,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error occurred while deleting from the database.');
    }
});

// 로그인한 사용자가 속한 그룹들 불러오기
app.get('/test/getGroupsByLoginUser/:uid', async (req, res) => {
    const { uid } = req.params;

    // SQL 쿼리 작성
    const query = {
        text: `
            SELECT sug.gid, sg.gname
            FROM scc_user_groups sug
            JOIN scc_group sg ON sug.gid = sg.gid
            WHERE uid = $1
        `,
        values: [uid], // SQL 인젝션 방지를 위해 매핑
    };

    try {
        // 데이터베이스 쿼리 실행
        const { rows } = await postgresql.query(query);

        // 결과 반환 (데이터가 없을 경우 빈 배열 반환)
        res.status(200).json(rows.length > 0 ? rows : []);
    } catch (error) {
        // 에러 처리
        console.error('Error fetching group data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// gid를 통해 결재선 불러오기
app.get('/test/getAprvDefaultByGid/:gid', async (req, res) => {
    const { gid } = req.params;

    // SQL 쿼리 작성
    const query = {
        text: `
            SELECT def_id, line_name
            FROM scc_aprv_default
            WHERE range_group =$1
        `,
        values: [gid], // SQL 인젝션 방지를 위해 매핑
    };

    try {
        // 데이터베이스 쿼리 실행
        const { rows } = await postgresql.query(query);

        // 결과 반환 (데이터가 없을 경우 빈 배열 반환)
        res.status(200).json(rows.length > 0 ? rows : []);
    } catch (error) {
        // 에러 처리
        console.error('Error fetching group data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// defId를 통해 결재선 내 결재 그룹과 결재 그룹 내 결재자 리스트 불러오기
app.get('/test/getApprovalsData/:defId', async (req, res) => {
    const { defId } = req.params;

    // SQL 쿼리 작성
    const queries = {
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
                    u.def_id = $1 and g.aprv_user_type = 0
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
                    udg.def_id = $1 and udg.aprv_user_type = 1
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
                    udg.def_id = $1 and udg.aprv_user_type = 2
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
        // Execute Type 1 Query
        const typeAprvData = await postgresql.query(queries.aprvLineTypeAprv(defId));
        if (typeAprvData.rows.length > 0) {
            const sortedApprovals = typeAprvData.rows.sort((a, b) => b.default_check - a.default_check);
            return res.send(sortedApprovals );
        }

        // Execute Type 2 Query
        const typeGroupData = await postgresql.query(queries.aprvLineTypeGroup(defId));
        if (typeGroupData.rows.length > 0) {
            return res.send(typeGroupData.rows );
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
            return res.send( result );
        }
    } catch (error) {
        // 에러 처리
        console.error('Error fetching group data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 8. 로그인된 사용자 id로 생성된 결재선에서 결재선 정보와 결재선 내 한 그룹의 결재자 리스트 가져오는 api (현재 미사용)
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

// 9. 로그인된 사용자 id와 결재선 status로 결재선 가져오는 api
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

// 10. 특정 mis_id의 라우트 가져오는 api
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

// 11. 특정 aprv_id, mis_id의 activity가 1(결순번)인 라우트 가져오는 api
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

// 12. 현재 사용자 정보를 받아와 다음 결재자 정보 불러오는 api
app.post('/test/getRouteForNextAprvByMis_idAndUser_idAndAg_num', async (req, res) => {
    const { mis_id, user_id, ag_num } = req.body;

    try {
        // 첫 번째 쿼리 실행
        const nextRouteAgNumQuery = {
            text: `
                SELECT r.next_ag_num 
                FROM scc_aprv_route r
                WHERE r.mis_id = $1 AND r.aprv_id = $2 AND r.ag_num = $3
            `,
            values: [mis_id, user_id, ag_num],
        };

        const { rows: firstResultRows } = await postgresql.query(nextRouteAgNumQuery);

        // 데이터가 없을 경우 빈 배열 반환
        if (!firstResultRows.length) {
            return res.json({ rows: [] });
        }

        // 두 번째 쿼리 실행
        const getNextRouteQuery = await Promise.all(
            firstResultRows.map(({ next_ag_num }) =>
                postgresql.query({
                    text: `
                        SELECT DISTINCT ON (r.ag_num) r.*
                        FROM scc_aprv_route r
                        WHERE r.mis_id = $1 AND r.ag_num = $2 AND r.activity = 2 AND r.aprv_id IS NULL
                    `,
                    values: [mis_id, next_ag_num],
                })
            )
        );

        // 병렬 실행 결과를 평탄화하여 하나의 배열로 반환
        const flattenedResults = getNextRouteQuery.flatMap(result => result.rows);

        res.json({ rows: flattenedResults });
    } catch (error) {
        console.error("Error occurred while fetching approval process and route:", error);
        res.status(500).send("Internal Server Error");
    }
});

// 13. 사용자와 결재 status에 맞춰 process 불러오는 api
app.post('/test/aprvProcessExtractByAprvIdAndStatus', async (req, res) => {
    const {user_id, status} = req.body;

    // status 값에 따라 p.status와 r.activity 조건 설정
    let statusCondition;

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

// 14. 현재 route 결재 진행
app.post('/test/updateCurrentUserRoute', async (req, res) => {
    // user_id -> 현재 로그인한 사용자 id
    // next_approval_id -> 다음 결재 라우트에 할당될 사용자 id

    const {
        mis_id, ag_num, activity, user_id, opinion,
        return_ag_num, next_approval_id, next_ag_num
    } = req.body;

    const queries = {
        findCurrentRoute: `
            SELECT * FROM scc_aprv_route
            WHERE mis_id = $1 AND aprv_id = $2 AND ag_num = $3
        `,
        findReturningRoute: `
            SELECT * FROM scc_aprv_route
            WHERE mis_id = $1 and ag_num = $2
        `,
        updateCurrentRoute: `
            UPDATE scc_aprv_route
            SET activity = $1, opinion = $2, activity_dt = CURRENT_TIMESTAMP
            WHERE mis_id = $3 AND aprv_id = $4 AND ag_num = $5 AND next_ag_num = $6 RETURNING *;
        `,
        recursiveRouteInit: `
            WITH RECURSIVE update_chain AS (
                -- 1단계: 주어진 ag_num과 return_ag_num에 해당하는 행을 선택
                SELECT
                    mis_id,
                    ag_num,
                    return_ag_num,
                    next_ag_num
                FROM
                    scc_aprv_route
                WHERE
                    mis_id = $1 AND ag_num = $2
                UNION ALL
                -- 2단계: next_ag_num이 다른 row들의 ag_num과 일치하는 행을 탐색
                SELECT
                    A.mis_id,
                    A.ag_num,
                    A.return_ag_num,
                    A.next_ag_num
                FROM
                    scc_aprv_route A
                        INNER JOIN
                    update_chain B
                    ON A.mis_id = B.mis_id AND A.ag_num = B.next_ag_num
            )
-- 현재 행의 activity를 1로 설정하고 opinion을 초기화
            UPDATE scc_aprv_route AS AA
            SET
                activity = CASE
                               WHEN BB.ag_num = $2 THEN 1
                               ELSE 2
                    END,
                aprv_id = CASE
                              WHEN BB.ag_num = $2 THEN AA.aprv_id
                              ELSE NULL 
                    END,
                opinion = ''
                FROM 
            update_chain BB
            WHERE
                AA.mis_id = BB.mis_id
              AND AA.ag_num = BB.ag_num;
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
            SET activity = 1
            WHERE mis_id = $1 AND ag_num = $2
        `,
        updateNextRouteAprvId:`
            UPDATE scc_aprv_route
            SET  aprv_id  = $3
            WHERE mis_id = $1 AND ag_num = $2
        `,
        initWholeRouteActivityMinus1:`
            WITH TopParent AS (
                SELECT ag_num
                FROM  scc_aprv_route AS parent
                WHERE parent.ag_num NOT IN (
                    SELECT child.next_ag_num
                    FROM scc_aprv_route AS child
                    WHERE child.next_ag_num != -1
                )
            )
            UPDATE scc_aprv_route
            SET activity = CASE
                WHEN ag_num IN (SELECT ag_num FROM TopParent) THEN 1
                ELSE 2
            END
            WHERE mis_id = $1;
        `
    };

    const executeQuery = async (query, params) => {
        try {
            return await postgresql.query(query, params);
        } catch (err) {
            throw new Error(`Query failed: ${err.message}`);
        }
    };
    const checkAndUpdateProcessStatus = async () => {
        // status 업데이트 및 라우터 확인
        const allRoutesStatus = await executeQuery(queries.checkAllRoutesActivity, [mis_id]);
        const { total_routes, completed_routes } = allRoutesStatus.rows[0];
        const activity4Exists = await executeQuery(queries.checkActivity4Exists, [mis_id]);


        if (activity4Exists.rows[0].count === 0) {
            if (completed_routes === total_routes) {
                // 결재선의 status 결재 완료로 업데이트
                await executeQuery(queries.updateProcessStatus, [2, mis_id]);
            } else if (activity === 'approve') {
                // 결재선의 status 결재 진행으로 업데이트
                await executeQuery(queries.updateProcessStatus, [1, mis_id]);
            }
        }
    };

    let responseData = { message: 'Route successfully updated.' };

    try {
        await postgresql.query('BEGIN');

        const currentRoute = await executeQuery(queries.findCurrentRoute, [mis_id, user_id, ag_num]);

        if (currentRoute.rowCount === 0) {
            throw new Error('No matching route found for the current user.');
        }

        // 라우트 취소 처리
        if (activity === 'cancel') {
            await executeQuery(queries.updateCurrentRoute, [4, opinion, mis_id, user_id, ag_num, next_ag_num]);
            await executeQuery(queries.updateCancelOpinion, [opinion, mis_id]);
            await executeQuery(queries.updateProcessStatus, [4, mis_id]);

            const dbRes = await executeQuery(queries.findReturningRoute, [mis_id, ag_num]);
            responseData = { message: 'cancel', aprv_id: dbRes.rows[0]?.aprv_id || null };
        }else if (activity === 'return') { // 라우트에서 반려 진행
            await executeQuery(queries.updateCurrentRoute, [2, opinion, mis_id, user_id, ag_num, next_ag_num]);
            if (return_ag_num === -1) {
                await executeQuery(queries.initWholeRouteActivityMinus1, [mis_id]);
            } else {
                await executeQuery(queries.recursiveRouteInit, [mis_id, return_ag_num]);
                const dbRes = await executeQuery(queries.findReturningRoute, [mis_id, return_ag_num]);
                responseData = { message: 'return', aprv_id: dbRes.rows[0]?.aprv_id || null };
            }
            await executeQuery(queries.insertReturnHistory, [mis_id, ag_num, return_ag_num, user_id, opinion, 0]);
            await executeQuery(queries.updateProcessStatus, [3, mis_id]);
        } else { // 라우트 결재 처리
            await executeQuery(queries.updateCurrentRoute, [3, opinion, mis_id, user_id, ag_num, next_ag_num]);
            await executeQuery(queries.updateNextRouteActivity, [mis_id, next_ag_num]);
            const dbRes = await executeQuery(queries.findReturningRoute, [mis_id, ag_num]);
            responseData = { message: 'aprv', aprv_id: dbRes.rows[0]?.aprv_id || null };
        }

        // 결재후 다음 결재 그룹에 결재자 할당
        if(next_approval_id !== ''){
            await postgresql.query(queries.updateNextRouteAprvId, [mis_id, next_ag_num, next_approval_id]);
        }
        await checkAndUpdateProcessStatus();

        await postgresql.query('COMMIT');
        res.status(200).json(responseData);
    } catch (error) {
        await postgresql.query('ROLLBACK');
        console.error('Error updating route:', error.message);
        res.status(500).json({
            message: 'Error updating route data.',
            error: error.message,
        });
    }
});

// 15. 사용자 sql 유효성 확인 api
app.post('/test/checkUserQuery', async (req, res) => {
    const { query } = req.body; // 요청 본문에서 필요한 값들 추출

    try {
        // 입력된 쿼리의 유효성 검사
        if (!query || !query.trim().toLowerCase().startsWith('select')) {
            return res.status(400).json({ message: 'select 문이 가장 앞에 와야합니다.' });
        }

        await postgresql.query('BEGIN');
        const usersData = await postgresql.query(query, []);
        await postgresql.query('COMMIT');
        res.send({ rows: usersData.rows || [] });
    } catch (err) {
        await postgresql.query('ROLLBACK');
        console.error("메세지 : ", err.message);

        // Syntax error에 대한 별도 처리
        if (err.message.includes('syntax error at end of input')) {
            return res.status(400).json({
                message: '쿼리 문법에 문제가 있습니다.',
                error: err.message,
            });
        }

        res.status(500).json({
            message: '쿼리 실행 시 문제가 있습니다',
            error: err.message,
        });
    }
});

// 16. 현재 결재자의 ag_num을 next_ag_num으로 가진, 아직 결재 안된 이전 결재 그룹이 있는지 확인 하는 api
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

