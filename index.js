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
app.post('/test/insertProcess', (req, res) => {
    const { title, info, input_id, aprv_id, def_id, group_auth_id, aprv_user_type } = req.body;

    const selectDefaultGroupByDefIdQuery = `
        SELECT g.group_name, g.ag_num, g.return_ag_num
        FROM scc_aprv_default_group g
        WHERE def_id = $1
        ORDER BY CASE
                     WHEN g.ag_num = (SELECT g_order.next_ag_num
                                      FROM scc_aprv_default_group_order g_order
                                      WHERE def_id = $1
                                        AND ag_num = 0) THEN 0
                     ELSE 1
                 END,
                 g.ag_num;
    `;

    const selectGroupOrderByDefIdAndAgNumQuery = `
        SELECT next_ag_num
        FROM scc_aprv_default_group_order
        WHERE def_id = $1 AND ag_num = $2;
    `;

    const insertProcessQuery = `
        INSERT INTO scc_aprv_process (title, info, status, del_flag, input_id, def_id, input_dt, module_name, status_dt,
                                      cancel_opinion, confirm_dt)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP, '',
                CURRENT_TIMESTAMP) RETURNING mis_id;
    `;

    postgresql.query('BEGIN', (err) => {
        if (err) {
            console.error('Transaction BEGIN error:', err);
            return res.status(500).send('Transaction failed.');
        }

        postgresql.query(insertProcessQuery, [title, info, 0, 0, input_id, def_id], (err, result) => {
            if (err) {
                console.error('Error inserting into scc_aprv_process:', err);
                return res.status(500).send('Error occurred while inserting into the database.');
            }

            const mis_id = result.rows[0].mis_id;

            postgresql.query(selectDefaultGroupByDefIdQuery, [def_id], (err, result) => {
                if (err) {
                    console.error('Error selecting default group by def_id:', err);
                    postgresql.query('ROLLBACK', (rollbackErr) => {
                        if (rollbackErr) {
                            console.error('Transaction ROLLBACK error:', rollbackErr);
                        }
                    });
                    return res.status(500).send('Error occurred while selecting default group.');
                }

                const groups = result.rows;
                const insertRoutePromises = [];

                groups.forEach((group, index) => {
                    const ag_num = group.ag_num;
                    const aprvIdValue = index === 0 ? aprv_id : '';
                    const activity = index === 0 ? 1 : 2;
                    const return_ag_num = group.return_ag_num;

                    insertRoutePromises.push(
                        new Promise((resolve, reject) => {
                            postgresql.query(selectGroupOrderByDefIdAndAgNumQuery, [def_id, ag_num], (err, result) => {
                                if (err) {
                                    console.error('Error selecting next_ag_num:', err);
                                    return reject(err);
                                }
                                const next_ag_num = result.rows.length > 0 ? result.rows[0].next_ag_num : -1;

                                const insertRouteQuery = `
                                    INSERT INTO scc_aprv_route (mis_id, ag_num, activity, activity_dt, aprv_id, opinion, delegated,
                                                                delegator, necessary, alarm_send_result, auth_id, aprv_user_type,
                                                                return_ag_num, next_ag_num, verify_query, read_dt,
                                                                aprv_user_list, aprv_user_query, skip_check, skip_query)
                                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '', CURRENT_TIMESTAMP,
                                            NULL, '', 0, '');
                                `;

                                postgresql.query(insertRouteQuery, [
                                    mis_id, ag_num, activity, null, aprvIdValue, '', 0, null, 0, '', group_auth_id,
                                    aprv_user_type, return_ag_num, next_ag_num
                                ], (err) => {
                                    if (err) {
                                        console.error('Error inserting into scc_aprv_route:', err);
                                        return reject(err);
                                    }
                                    resolve();
                                });
                            });
                        })
                    );
                });

                Promise.all(insertRoutePromises)
                    .then(() => {
                        postgresql.query('COMMIT', (commitErr) => {
                            if (commitErr) {
                                console.error('Transaction COMMIT error:', commitErr);
                                return res.status(500).send('Transaction commit failed.');
                            }
                            res.status(201).send({ message: 'Data inserted successfully', mis_id });
                        });
                    })
                    .catch((err) => {
                        console.error('Error inserting into scc_aprv_route:', err);
                        postgresql.query('ROLLBACK', (rollbackErr) => {
                            if (rollbackErr) {
                                console.error('Transaction ROLLBACK error:', rollbackErr);
                            }
                        });
                        return res.status(500).send('Error occurred while inserting into the route table.');
                    });
            });
        });
    });
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

        // 노드 및 사용자 처리
        const nodes = convertedGojsDataJson.nodeDataArray.slice(1);
        for (const node of nodes) {
            const result = await postgresql.query(queries.insertGroup, [
                defId,
                node.group_name,
                node.aprv_user_type,
                node.aprv_group,
                node.aprv_user_query,
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
                convertAgNumKeySet[node.return_ag_num] || null,
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
            return_ag_num: convertAgNumKeySet[node.return_ag_num] || node.return_ag_num,
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
// app.post('/test/checkUserByAgNum', (req, res) => {
//     const {def_id, ag_num} = req.body;
//
//     // aprv_user_type을 가져오는 쿼리
//     const queryTypeQuery = {
//         text: `SELECT ag_num, def_id, aprv_user_type
//                FROM scc_aprv_default_group
//                WHERE ag_num = $1
//                  AND def_id = $2`,
//         values: [ag_num, def_id],
//     };
//
//     // aprv_user_type이 0일 때 사용할 쿼리
//     const aprvTypeQuery = {
//         text: "SELECT du.*, u.uname FROM scc_aprv_default_user du JOIN scc_user u ON du.aprv_id = u.uid WHERE def_id = $1 AND ag_num = $2",
//         values: [def_id, ag_num],
//     };
//
//     // aprv_user_type이 1일 때 사용할 쿼리
//     const groupTypeQuery = {
//         text: `SELECT ug.uid as aprv_id,
//                       udg.auth_id,
//                       udg.ag_num,
//                       udg.aprv_user_type,
//                       udg.skip_query,
//                       udg.return_ag_num,
//                       u.uname
//                FROM scc_user_groups ug
//                         JOIN scc_aprv_default_group udg ON ug.gid = udg.aprv_group
//                         JOIN scc_user u ON ug.uid = u.uid
//                WHERE udg.def_id = $1
//                  AND udg.ag_num = $2`,
//         values: [def_id, ag_num],
//     };
//
//     const aprvLineTypeSqlQuery = {
//         text: `SELECT udg.auth_id,
//                       udg.ag_num,
//                       udg.aprv_user_type,
//                       udg.skip_query,
//                       udg.return_ag_num,
//                       udg.aprv_user_query
//                FROM scc_aprv_default_group udg
//                WHERE udg.def_id = $1
//                  AND udg.ag_num = $2`,
//         values: [def_id, ag_num] // 첫 번째 쿼리 결과에서 얻은 def_id 값을 사용
//     };
//
//
//     postgresql.query(queryTypeQuery, (typeErr, typeData) => {
//         if (typeErr) {
//             return res.status(500).json({message: 'Error fetching aprv_user_type'});
//         }
//
//         if (typeData.rows.length === 0) {
//             return res.status(404).json({message: 'No matching group found'});
//         }
//
//         const {aprv_user_type} = typeData.rows[0];
//
//         if (aprv_user_type === 0) {
//             // aprv_user_type이 0일 때 aprvTypeQuery 실행
//             postgresql.query(aprvTypeQuery, (err, aprvTypeData) => {
//                 if (err) {
//                     return res.status(500).json({message: 'Error checking user by seq'});
//                 }
//
//                 // aprvTypeData.rows가 있을 경우 정렬 후 결과 할당
//                 const aprvTypeNextAprv = aprvTypeData.rows.length > 0
//                     ? aprvTypeData.rows.sort((a, b) => b.default_check - a.default_check)
//                     : [];
//
//                 return res.status(200).json({res: aprvTypeNextAprv});
//             });
//         } else if (aprv_user_type === 1) {
//             // aprv_user_type이 1일 때 groupTypeQuery 실행
//             postgresql.query(groupTypeQuery, (groupErr, groupTypeData) => {
//                 if (groupErr) {
//                     return res.status(500).json({message: 'Error checking group by seq'});
//                 }
//
//                 const groupTypeNextAprv = groupTypeData.rows.length > 0 ? groupTypeData.rows : [];
//                 return res.status(200).json({res: groupTypeNextAprv});
//             });
//         } else if (aprv_user_type === 2) {
//             // aprv_user_type이 2일 때 sqlTypeQuery 실행
//             const aprvLineTypeSqlQueryData = postgresql.query(aprvLineTypeSqlQuery);
//             console.log(aprvLineTypeSqlQueryData)
//             const selectedSqlQuery = {
//                 text: `${aprvLineTypeSqlQueryData.rows[0].aprv_user_query}`
//             }
//             // 선택된 쿼리가 잘못된 경우, 클라이언트에서 에러 얼럿 띄워주기
//             const selectedSqlQueryData = postgresql.query(selectedSqlQuery);
//
//             function convertUidToAprvId(array) {
//                 return array.map(item => {
//                     const {uid, ...rest} = item;
//                     return {aprv_id: uid, ...rest};
//                 });
//             }
//
//             const result = convertUidToAprvId(selectedSqlQueryData.rows);
//             return res.status(200).json({res: result});
//         } else {
//             return res.status(400).json({message: 'Invalid aprv_user_type'});
//         }
//     });
// });
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

    const aprvLineSelectQuery = {
        text: `
            SELECT *
            FROM scc_aprv_default
            WHERE range_group in (SELECT gid
                                  FROM scc_user_groups
                                  WHERE uid = $1)
            ORDER BY def_id DESC LIMIT 1
        `,
        values: [uid],
    };

    const AllAprvLineSelectQuery = {
        text: `
            SELECT *
            FROM scc_aprv_default
            WHERE range_group = -1
        `,
    };

    try {
        // 첫 번째 쿼리 실행
        let aprvLineData = await postgresql.query(aprvLineSelectQuery);

        if (aprvLineData.rows.length === 0) {
            // 두 번째 쿼리 실행 (첫 번째 쿼리에서 결과가 없을 경우)
            aprvLineData = await postgresql.query(AllAprvLineSelectQuery);
        }

        if (aprvLineData.rows.length === 0) {
            return res.status(404).send("결재선이 존재하지 않습니다.");
        }

        const aprvLineDefId = aprvLineData.rows[0].def_id;

        // 첫 번째 유형 쿼리
        const aprvLineTypeAprvQuery = {
            text: `SELECT
                       u.aprv_id, u.ag_num,u.default_check,
                       g.group_name, g.aprv_user_type, g.auth_id, g.skip_query, g.return_ag_num,
                       su.uname
                   FROM
                       scc_aprv_default_user u
                           JOIN scc_aprv_default_group g ON u.ag_num = g.ag_num
                           JOIN scc_user su ON u.aprv_id = su.uid
                   WHERE u.def_id = $1 AND u.ag_num = (SELECT g_order.next_ag_num
                                                       FROM scc_aprv_default_group_order g_order
                                                       WHERE def_id = $1
                                                         AND ag_num = 0)`,
            values: [aprvLineDefId],
        };

        const aprvLineTypeAprvData = await postgresql.query(aprvLineTypeAprvQuery);

        // 안된다
        if (aprvLineTypeAprvData.rows.length > 0) {
            // 첫 번째 유형 쿼리에서 결과가 있으면 이후 진행 중단
            const sorted_aprvTypeNextAprv = aprvLineTypeAprvData.rows.length > 0
                ? aprvLineTypeAprvData.rows.sort((a, b) => b.default_check - a.default_check)
                : [];
            return res.send({ aprv_data: aprvLineData.rows, approvals: sorted_aprvTypeNextAprv });
        }

        // 두 번째 유형 쿼리
        const aprvLineTypeSqlQuery = {
            text: `SELECT udg.auth_id,
                          udg.ag_num,
                          udg.aprv_user_type,
                          udg.skip_query,
                          udg.return_ag_num,
                          udg.aprv_user_query
                   FROM scc_aprv_default_group udg
                   WHERE udg.def_id = $1
                     AND udg.ag_num = (SELECT g_order.next_ag_num
                                       FROM scc_aprv_default_group_order g_order
                                       WHERE def_id = $1
                                         AND ag_num = 0)`,
            values: [aprvLineDefId],
        };

        const aprvLineTypeSqlQueryData = await postgresql.query(aprvLineTypeSqlQuery);

        if (aprvLineTypeSqlQueryData.rows.length > 0) {
            // 두 번째 유형 쿼리에서 결과가 있으면 이후 진행 중단
            return res.send({ aprv_data: aprvLineData.rows, approvals: aprvLineTypeSqlQueryData.rows });
        }

        // 세 번째 유형 쿼리
        const aprvLineTypeSqlGroupDataQuery = {
            text: `
                SELECT * FROM scc_aprv_default_group 
                WHERE def_id = $1 AND ag_num = $2
            `,
            values: [aprvLineDefId, aprvLineTypeSqlQueryData.rows[0]?.ag_num],
        };

        const aprvLineTypeSqlGroupDataQueryData = await postgresql.query(aprvLineTypeSqlGroupDataQuery);

        const selectedSqlQuery = {
            text: aprvLineTypeSqlQueryData.rows[0]?.aprv_user_query,
        };

        let selectedSqlQueryData;
        try {
            selectedSqlQueryData = await postgresql.query(selectedSqlQuery);
        } catch (queryError) {
            console.error("Custom SQL Query Error:", queryError);
            return res.status(400).send("사용자 정의 SQL 쿼리 실행 중 오류가 발생했습니다.");
        }

        function convertUidToAprvId(array) {
            return array.map(item => {
                const { uid, ...rest } = item;
                return { aprv_id: uid, ...rest };
            });
        }

        const aprvLineTypeData = aprvLineTypeSqlGroupDataQueryData.rows[0];

        const result = convertUidToAprvId(selectedSqlQueryData.rows).map(row => ({
            ...row,
            aprv_user_type: aprvLineTypeData.aprv_user_type,
            auth_id: aprvLineTypeData.auth_id,
            skip_query: aprvLineTypeData.skip_query,
            return_ag_num: aprvLineTypeData.return_ag_num,
        }));

        res.send({
            aprv_data: aprvLineData.rows,
            approvals: result,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while fetching approval line.");
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
    const query = {
        text: `
            SELECT *
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

// 특정 aprv_id, mis_id의 라우트 가져오는 api
app.post('/test/getApprovalByAprvIdAndMisId', async (req, res) => {
    const {user_id, mis_id} = req.body;

    const query = {
        text: `
            select *
            from scc_aprv_route r
            WHERE r.aprv_id = $1
              AND r.mis_id = $2
              AND r.activity IN (1, 2);
        `,
        values: [user_id, mis_id],
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
})

// 결재 확인 (사용자가 결재할 요청 보는 화면)
app.post('/test/aprvProcessExtractByAprvIdAndStatus', async (req, res) => {
    const {user_id, status} = req.body;

    // status 값에 따라 p.status와 r.activity 조건 설정
    let statusCondition;
    let activityCondition;

    // if (status === 0) { // 결재 예정
    //     statusCondition = `p.status = 0`;
    // activityCondition = `r.activity = 1`;
    // } else

    if (status === 1) { // 결재 예정, 결재 진행
        statusCondition = `p.status = 0 or p.status = 1`;
        // activityCondition = `r.activity = 3`;
    } else if (status === 2) { // 전체 결재 완료
        statusCondition = `p.status = 2`;
        // activityCondition = `r.activity = 3`;
        // 결재자와 액티비티가 같은 row가 2개 이상 있는 경우로 인해 프로세스 중복해서 가져오는 오류 있음
    } else if (status === 3) {  // 결재 반려
        statusCondition = `p.status = 3`;
        // activityCondition = `r.activity = 4`;
        // 결재자와 액티비티가 같은 row가 2개 이상 있는 경우로 인해 프로세스 중복해서 가져오는 오류 있음
    } else {
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
--               AND ${activityCondition};
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
app.post('/test/updateCurrentUserRoute',async (req, res)=>{
    const {mis_id, ag_num, activity, user_id, opinion, next_ag_num} = req.body;
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
    try{
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
            // 현재 로그인한 사용자가 결재하는 경우
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
})

// 다음 route 결재 진행
app.post('/test/updateNextUserRoute',async (req, res)=>{

    const {mis_id,  next_approval_id, next_ag_num} = req.body; // 요청 본문에서 필요한 값들 추출


    // SQL 쿼리 4: 다음 라우트를 업데이트하는 쿼리. where에 별도의 조건이 필요하다. 결재자 타입과 그룹타입 모두 라우트의 고유한 키를
    const updateNextRouteQuery = `
        UPDATE scc_aprv_route
        SET activity = 1,
            aprv_id  = $1
        WHERE mis_id = $2
          AND ag_num = $3 RETURNING *;
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
    console.log(req.body)
    const getSameNextAgNumRouteQuery = `
        select * from  scc_aprv_route
        WHERE mis_id = $1 AND ag_num != $2
          AND next_ag_num = $3 AND activity IN (2, 4);
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

        await postgresql.query(updateNextRouteQuery, [next_approval_id, mis_id, next_ag_num]);

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
