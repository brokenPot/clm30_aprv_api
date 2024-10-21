const { Client } = require("pg");
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

app.use(cors()); // cors 미들웨어를 삽입합니다.
// cors 미들웨어를 삽입합니다.
app.use(express.json());

const HOST = '127.0.0.1'; // 로컬 IP 기본값
const PORT = 8080;

//서버연결
server.listen(PORT, HOST, ()=>{
	postgresql.connect();
})

// 결재선 전체 get
app.get('/test/aprvDefault', async (req, res) => {
	const query = {
		text: "SELECT * FROM scc_aprv_default",
	};

	try {
		const { rows } = await postgresql.query(query); // async/await 사용으로 비동기 코드 처리
		res.status(200).json(rows); // rows를 바로 응답
	} catch (error) {
		console.error('Error fetching approval default:', error);
		res.status(500).send('Internal Server Error');
	}
});

// 한가지 결재선 get
app.get('/test/aprvDefault/:def_id',  (req, res) => {
	const def_id = req.params.def_id; // URL 파라미터로부터 def_id를 가져옵니다.

	const query = {
		text: "SELECT * FROM scc_aprv_default SM WHERE SM.def_id = $1", // $1은 첫 번째 파라미터를 의미
		values: [def_id], // 파라미터에 해당하는 값
	};

	try {
		const data =  postgresql.query(query);

		if (data.rows.length === 0) {
			return res.status(404).send("Approval line not found.");
		}

		res.send(data.rows[0]); // 한 가지 결재선만 반환
	} catch (err) {
		console.log(err);
		res.status(500).send("Error occurred while fetching approval line.");
	}
});

// 결재선 추가
app.post('/test/insertDefault',  (req, res) => {
	const { line_name, range_group } = req.body;
	const input_dt = new Date();
	const input_id = 'system';  // 임시로 'system' 지정

	// 첫 번째 쿼리: scc_aprv_default 테이블에 데이터 삽입
	const insertDefaultQuery = {
		text: `INSERT INTO scc_aprv_default (range_group, line_name, line_depth, input_dt, input_id, gojs_data)
           VALUES ($1, $2, 0, $3, $4, $5) RETURNING def_id`,
		values: [
			range_group,
			line_name,
			input_dt,
			input_id,
			{
				class: "GraphLinksModel",
				modelData: {
					canRelink: true
				},
				linkDataArray: [],
				nodeDataArray: [],  // 이 단계에서는 빈 배열로 설정
				linkKeyProperty: "key"
			}
		],
	};

	// PostgreSQL 쿼리 실행
	 postgresql.query(insertDefaultQuery, (err, result) => {
		if (err) {
			res.status(500).send('Error occurred while inserting into the database.');
		} else {
			res.status(201).send({ message: 'Data inserted and updated successfully.' })
		}
	});

	// select def_id from scc_aprv_de
});

// 결재선 삭제 리팩토링
app.delete('/test/deleteDefault/:def_id', async (req, res) => {
	const { def_id } = req.params;

	try {
		const result = await deleteDefaultFromDatabase(def_id);
		if (result.rowCount === 0) {
			return res.status(404).send('No record found with the given def_id.');
		}
		res.status(200).send({ message: 'Data deleted successfully.' });
	} catch (error) {
		console.error(error);
		res.status(500).send('Error occurred while deleting from the database.');
	}
});
const deleteDefaultFromDatabase = async (def_id) => {
	// 먼저 scc_aprv_default_group 테이블에서 연결된 데이터를 삭제
	const deleteGroupQuery = {
		text: `DELETE FROM scc_aprv_default_group WHERE def_id = $1`,
		values: [def_id],
	};

	// 그 후 scc_aprv_default 테이블에서 데이터를 삭제
	const deleteDefaultQuery = {
		text: `DELETE FROM scc_aprv_default WHERE def_id = $1`,
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

// 결재선 내 결제 그룹 제외 수정 및 저장
app.post('/test/updateAprv/:def_id',  (req, res) => {
	const { def_id } = req.params; // URL에서 def_id 추출
	const { line_name,   range_group } = req.body; // 요청 본문에서 각 컬럼 데이터 추출

	// SQL UPDATE 쿼리
	const query = `
		UPDATE scc_aprv_default
		SET line_name = $2,
			range_group = $3,
			update_dt = CURRENT_TIMESTAMP
		WHERE def_id = $1
			RETURNING def_id;
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

// 결재선 내 결제 그룹만 수정 및 저장
// app.post('/test/updateGroup/:def_id', async (req, res) => {
// 	const { def_id } = req.params; // URL에서 def_id 추출
// 	const { gojs_data, line_depth } = req.body; // 요청 본문에서 JSON 데이터 추출
//
// 	if (typeof gojs_data !== 'string') {
// 		return res.status(400).json({ message: "gojs_data must be a string" });
// 	}
//
// 	let converted_gojs_data;
// 	try {
// 		converted_gojs_data = JSON.parse(gojs_data); // 문자열을 객체로 변환
// 	} catch (err) {
// 		console.error("Invalid JSON format for gojs_data", err);
// 		return res.status(400).json({ message: "Invalid JSON format for gojs_data" });
// 	}
//
// 	const insertGroupQuery = `
//     INSERT INTO scc_aprv_default_group
//       (def_id, group_name, seq, aprv_user_type, aprv_group, aprv_user_query, auth_id, verify_query,
//       aprv_skip, skip_query, return_seq, selected_group_id, verify_query_sql)
//     VALUES
//       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
//     RETURNING *;
//   `;
//
//
// 	for (const node of converted_gojs_data.nodeDataArray) {
// 		// 그룹 데이터 삽입
// 		await insertNodeData(insertGroupQuery, node, def_id);
//
// 		// aprv_user_type이 0인 경우에 대한 처리
// 		if (node.aprv_user_type === 0 && node.selectedapprovals && node.selectedapprovals.length > 0) {
// 			for (const approval of node.selectedapprovals) {
// 				const { name, seq, aprv_id, default_check} = approval;
//
// 				// 사용자 데이터 삽입 (user_id는 자동 생성되므로 제외)
// 				await postgresql.query(insertUserQuery, [def_id, seq, aprv_id, default_check, '', name]);
// 			}
// 		}
// 	}
//
//
//
//
// 	const updateQuery = `
//     UPDATE scc_aprv_default
//     SET gojs_data = $2,
//         line_depth = $3,
//         update_dt = CURRENT_TIMESTAMP
//     WHERE def_id = $1
//     RETURNING *;
//   `;
//
// 	const insertUserQuery = `
//     INSERT INTO scc_aprv_default_user
//       (def_id, seq, aprv_id, default_check, group_id, user_name)
//     VALUES
//       ($1, $2, $3, $4, $5, $6)
//     RETURNING *;
//   `;
//
// 	console.log(converted_gojs_data.nodeDataArray);
//
// 	try {
// 		// 트랜잭션 시작
// 		await postgresql.query('BEGIN');
//
// 		// scc_aprv_default 테이블 업데이트
// 		const updateResult = await postgresql.query(updateQuery, [def_id, converted_gojs_data, line_depth]);
//
// 		if (updateResult.rowCount === 0) {
// 			await postgresql.query('ROLLBACK');
// 			return res.status(404).json({ message: 'No group found with the given def_id' });
// 		}
//
// 		// 기존 데이터를 삭제한 후, 새 데이터를 삽입하는 로직으로 대체
// 		await postgresql.query('DELETE FROM scc_aprv_default_group WHERE def_id = $1', [def_id]);
// 		await postgresql.query('DELETE FROM scc_aprv_default_user WHERE def_id = $1', [def_id]); // 사용자 데이터 삭제
//
// 		for (const node of converted_gojs_data.nodeDataArray) {
// 			// 그룹 데이터 삽입
// 			await insertNodeData(insertGroupQuery, node, def_id);
//
// 			// aprv_user_type이 0인 경우에 대한 처리
// 			if (node.aprv_user_type === 0 && node.selectedapprovals && node.selectedapprovals.length > 0) {
// 				for (const approval of node.selectedapprovals) {
// 					const { name, seq, aprv_id, default_check, group_id } = approval;
//
// 					// 사용자 데이터 삽입 (user_id는 자동 생성되므로 제외)
// 					await postgresql.query(insertUserQuery, [def_id, seq, aprv_id, default_check, group_id, name]);
// 				}
// 			}
// 		}
//
// 		// 트랜잭션 커밋
// 		await postgresql.query('COMMIT');
//
// 		res.status(200).json({
// 			message: 'Group data successfully updated and inserted',
// 			data: updateResult.rows[0],
// 		});
//
// 	} catch (err) {
// 		// 에러 발생 시 트랜잭션 롤백
// 		await postgresql.query('ROLLBACK');
// 		console.error('Error during transaction', err);
// 		res.status(500).json({
// 			message: 'Server error while updating or inserting group data',
// 			error: err.message,
// 		});
// 	}
// });
app.post('/test/updateGroup/:def_id', async (req, res) => {
	const { def_id } = req.params; // URL에서 def_id 추출
	const { gojs_data, line_depth } = req.body; // 요청 본문에서 JSON 데이터 추출

	if (typeof gojs_data !== 'string') {
		return res.status(400).json({ message: "gojs_data must be a string" });
	}

	let converted_gojs_data;
	try {
		converted_gojs_data = JSON.parse(gojs_data); // 문자열을 객체로 변환
	} catch (err) {
		console.error("Invalid JSON format for gojs_data", err);
		return res.status(400).json({ message: "Invalid JSON format for gojs_data" });
	}

	const insertGroupQuery = `
    INSERT INTO scc_aprv_default_group
      (def_id, group_name, seq, aprv_user_type, aprv_group, aprv_user_query, auth_id, verify_query,
      aprv_skip, skip_query, return_seq, selected_group_id, verify_query_sql)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING group_id;
  `;

	const insertUserQuery = `
    INSERT INTO scc_aprv_default_user
      (def_id, seq, aprv_id, default_check, group_id, user_name)
    VALUES
      ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;

	const updateQuery = `
    UPDATE scc_aprv_default
    SET gojs_data = $2,
        line_depth = $3,
        update_dt = CURRENT_TIMESTAMP
    WHERE def_id = $1
    RETURNING *;
  `;

	try {
		// 트랜잭션 시작
		await postgresql.query('BEGIN');

		// scc_aprv_default 테이블 업데이트
		const updateResult = await postgresql.query(updateQuery, [def_id, converted_gojs_data, line_depth]);

		if (updateResult.rowCount === 0) {
			await postgresql.query('ROLLBACK');
			return res.status(404).json({ message: 'No group found with the given def_id' });
		}

		// 기존 데이터를 삭제한 후, 새 데이터를 삽입하는 로직으로 대체
		await postgresql.query('DELETE FROM scc_aprv_default_group WHERE def_id = $1', [def_id]);
		await postgresql.query('DELETE FROM scc_aprv_default_user WHERE def_id = $1', [def_id]); // 사용자 데이터 삭제

		for (const node of converted_gojs_data.nodeDataArray) {
			// 그룹 데이터 삽입
			const groupInsertResult = await postgresql.query(insertGroupQuery, [
				def_id,
				node.group_name,
				node.seq,
				node.aprv_user_type,
				node.aprv_group,
				node.aprv_user_query,
				node.auth_id,
				node.verify_query,
				node.aprv_skip,
				node.skip_query,
				node.return_seq,
				node.selected_group_id,
				node.verify_query_sql
			]);

			const group_id = groupInsertResult.rows[0].group_id;

			// aprv_user_type이 0인 경우에 대한 처리
			if (node.aprv_user_type === 0 && node.selectedapprovals && node.selectedapprovals.length > 0) {
				for (const approval of node.selectedapprovals) {
					const { name, seq, aprv_id, default_check } = approval;

					// 사용자 데이터 삽입 (user_id는 자동 생성되므로 제외)
					await postgresql.query(insertUserQuery, [def_id, seq, aprv_id, default_check, group_id, name]);
				}
			}
		}

		// 트랜잭션 커밋
		await postgresql.query('COMMIT');

		res.status(200).json({
			message: 'Group data successfully updated and inserted',
			data: updateResult.rows[0],
		});

	} catch (err) {
		// 에러 발생 시 트랜잭션 롤백
		await postgresql.query('ROLLBACK');
		console.error('Error during transaction', err);
		res.status(500).json({
			message: 'Server error while updating or inserting group data',
			error: err.message,
		});
	}
});

// 노드 데이터 삽입 함수
async function insertNodeData(insertQuery, node, def_id) {
	const {
		key, loc, seq, name, aprv_group, group_name, aprv_user_type, aprv_user_query,
		auth_id, verify_query, aprv_skip, skip_query, return_seq, selected_group_id, verify_query_sql, category
	} = node;

	await postgresql.query(insertQuery, [
		def_id, group_name, seq, aprv_user_type, aprv_group, aprv_user_query, auth_id,
		verify_query, aprv_skip, skip_query, return_seq, selected_group_id, verify_query_sql,
		// key, loc, name, category
	]);
}


// 특정 range_group 중복 여부 확인 API 리팩토링
app.post('/test/checkRangeGroup', (req, res) => {
	const { range_group, def_id } = req.body;
		const query = {
		text: "SELECT COUNT(*) FROM scc_aprv_default WHERE range_group = $1 AND def_id != $2",
		values: [range_group, def_id],
	};

	postgresql.query(query, (err, data) => {
		if (err) {
			return res.status(500).json({ message: 'Error checking range group' });
		} else {
			const count = parseInt(data.rows[0].count, 10);
			if (count > 0) {
				if (range_group === -1) {
					return res.status(400).json({ message: 'FULL_GROUP_DUPLICATE' });
				} else {
					return res.status(400).json({ message: 'GROUP_DUPLICATE' });
				}
			} else {
				return res.status(200).json({ message: 'Range group is valid' });
			}
		}
	});
});

app.post('/test/insertProcess', (req, res) => {
	console.log(req.body);
	const { title, info, input_id, aprv_id, aprv_line_depth, def_id, group_seq, group_auth_id, aprv_user_type } = req.body;

	const insertProcessQuery = `
		INSERT INTO scc_aprv_process (
			title, info, status, del_flag, input_id, input_dt, module_name, status_dt, cancel_opinion, confirm_dt
		) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP)
			RETURNING mis_id;
	`;

	postgresql.query('BEGIN', (err) => {
		if (err) {
			console.error('Transaction BEGIN error:', err);
			return res.status(500).send('Transaction failed.');
		}

		console.log('쿼리 시작');
		postgresql.query(insertProcessQuery, [title, info, 0, 0, input_id], (err, result) => {
			if (err) {
				console.error('Error inserting into scc_aprv_process:', err);
				return res.status(500).send('Error occurred while inserting into the database.');
			}

			const mis_id = result.rows[0].mis_id;

			const insertRoutePromises = [];

			console.log("aprv_line_depth : ", aprv_line_depth);

			for (let i = 0; i < aprv_line_depth; i++) {
				const seq = i + 1;
				const aprvIdValue = i === 0 ? aprv_id : '';

				const insertRouteQuery = `
                    INSERT INTO scc_aprv_route (
                        mis_id, seq, activity, activity_dt, aprv_id, opinion, delegated, delegator,
                        necessary, default_seq, alarm_send_result, auth_id, verify_query, read_dt,
                        aprv_user_type, aprv_user_list, aprv_user_query, skip_check, skip_query, return_seq
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', $11, '', null, $12, '', '', null, '', null);
                `;

				insertRoutePromises.push(
					postgresql.query(insertRouteQuery, [
						mis_id, seq, 0, null, aprvIdValue, '', 0, null, 0, seq, group_auth_id, aprv_user_type
					])
				);
			}

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


// 결재선에 속한 그룹 하나 가져오기
// app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {
// 	const uid = req.params.uid; // URL 파라미터로부터 uid를 가져옵니다.
//
// 	// 첫 번째 쿼리 작성 (scc_aprv_default 테이블 조회)
// 	const query1 = {
// 		text: `
//       SELECT *
//       FROM scc_aprv_default
//       WHERE range_group = (
//         SELECT gid
//         FROM scc_user_groups
//         WHERE uid = $1
//         LIMIT 1
//       )`,
// 		values: [uid], // 첫 번째 파라미터로 uid 값을 넣습니다.
// 	};
//
// 	try {
// 		// 첫 번째 쿼리 실행
// 		const data1 = await postgresql.query(query1);
//
// 		// 데이터가 없을 경우 404 응답
// 		if (data1.rows.length === 0) {
// 			return res.status(404).send("Approval line not found.");
// 		}
//
//
// 		const defId = data1.rows[0].def_id; // 첫 번째 쿼리에서 가져온 def_id 사용
// 		const query2 = {
// 			text: `
//         SELECT *
//         FROM scc_aprv_default_user
//         WHERE def_id = $1 AND seq = 1`,
// 			values: [defId], // 첫 번째 쿼리 결과에서 얻은 def_id 값을 사용
// 		};
// 		console.log(data1)
// 		// 두 번째 쿼리 실행
// 		const data2 = await postgresql.query(query2);
//
//
//
// 		// 두 번째 쿼리의 결과와 첫 번째 쿼리의 결과를 함께 반환
// 		res.send({
// 			aprv_data:data1.rows,
// 			approvals:data2.rows
// 	});
//
// 	} catch (err) {
// 		console.error(err);
// 		res.status(500).send("Error occurred while fetching approval line.");
// 	}
// });
app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {
	const uid = req.params.uid; // URL 파라미터로부터 uid를 가져옵니다.

	// 첫 번째 쿼리 작성 (scc_aprv_default 테이블 조회)
	const query1 = {
		text: `
            SELECT * 
            FROM scc_aprv_default 
            WHERE range_group = (
                SELECT gid 
                FROM scc_user_groups
                WHERE uid = $1 
                LIMIT 1
            )`,
		values: [uid], // 첫 번째 파라미터로 uid 값을 넣습니다.
	};

	try {
		// 첫 번째 쿼리 실행
		const data1 = await postgresql.query(query1);

		// 데이터가 없을 경우 404 응답
		if (data1.rows.length === 0) {
			return res.status(404).send("Approval line not found.");
		}

		const defId = data1.rows[0].def_id; // 첫 번째 쿼리에서 가져온 def_id 사용
		const query2 = {
			text: `SELECT
					   u.aprv_id, u.user_name, u.seq, u.user_id,
					   g.group_name, g.aprv_user_type,g.auth_id, g.skip_query,g.return_seq
				   FROM
					   scc_aprv_default_user u
						   JOIN
					   scc_aprv_default_group g
					   ON
						   u.group_id = g.group_id WHERE u.def_id = $1 AND u.seq = 1`,
			values: [defId], // 첫 번째 쿼리 결과에서 얻은 def_id 값을 사용
		};


		// 두 번째 쿼리 실행
		const data2 = await postgresql.query(query2);

		// 두 번째 쿼리의 결과와 첫 번째 쿼리의 결과를 함께 반환
		res.send({
			aprv_data: data1.rows,
			approvals: data2.rows
		});

	} catch (err) {
		console.error(err);
		res.status(500).send("Error occurred while fetching approval line.");
	}
});


