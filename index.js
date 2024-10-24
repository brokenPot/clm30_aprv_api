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

// 결재선 컨펌 데이트 업데이트 api
app.post('/test/updateConfirmDate', (req, res) => {
	const { mis_id } = req.body; // 요청 본문에서 mis_id 추출

	// SQL UPDATE 쿼리
	const query = `
    UPDATE scc_aprv_process
    SET confirm_dt = CURRENT_TIMESTAMP
    WHERE mis_id = $1
    RETURNING mis_id;
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


// 결재선 내 결제 그룹만 수정 및 저장
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

// 결재선 추가 및 수정 시 결재선과 결재 그룹 저장 및 수정 하는 api
app.post('/test/updateOrInsertAprv/:def_id', async (req, res) => {

	console.log( req.params)
	console.log( req.body)

	const { def_id } = req.params; // URL에서 def_id 추출
	const { line_name, range_group, gojs_data, line_depth,input_id } = req.body; // 요청 본문에서 각 컬럼 데이터 추출



	if (typeof gojs_data !== 'string') {
		return res.status(400).json({ message: "gojs_data must be a string" });
	}

	let converted_gojs_data;
	try {
		converted_gojs_data = JSON.parse(gojs_data); // gojs_data를 객체로 변환
	} catch (err) {
		console.error("Invalid JSON format for gojs_data", err);
		return res.status(400).json({ message: "Invalid JSON format for gojs_data" });
	}

	const insertDefaultQuery = `
        INSERT INTO scc_aprv_default (range_group, line_name, line_depth, input_dt, gojs_data, input_id)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)
        RETURNING def_id;
    `;

	const updateDefaultQuery = `
        UPDATE scc_aprv_default
        SET line_name = $2, range_group = $3, gojs_data = $4, line_depth = $5, update_dt = CURRENT_TIMESTAMP
        WHERE def_id = $1
        RETURNING def_id;
    `;

	const insertGroupQuery = `
        INSERT INTO scc_aprv_default_group (def_id, group_name, seq, aprv_user_type, aprv_group, aprv_user_query, auth_id, verify_query, aprv_skip, skip_query, return_seq, selected_group_id, verify_query_sql)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING group_id;
    `;

	const insertUserQuery = `
        INSERT INTO scc_aprv_default_user (def_id, seq, aprv_id, default_check, group_id, user_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
    `;

	try {
		// 트랜잭션 시작
		await postgresql.query('BEGIN');

		let defId;
		if (def_id!=='0') {
			// 기존 데이터를 업데이트하는 경우
			const updateResult = await postgresql.query(updateDefaultQuery, [def_id, line_name, range_group, converted_gojs_data, line_depth]);
			if (updateResult.rowCount === 0) {
				await postgresql.query('ROLLBACK');
				return res.status(404).json({ message: 'No record found with the given def_id' });
			}
			defId = updateResult.rows[0].def_id;
		} else {
			// 새로운 데이터를 삽입하는 경우
			const insertResult = await postgresql.query(insertDefaultQuery, [range_group, line_name, line_depth, converted_gojs_data,input_id]);
			defId = insertResult.rows[0].def_id;
		}

		// 기존 그룹 및 사용자 데이터 삭제
		await postgresql.query('DELETE FROM scc_aprv_default_group WHERE def_id = $1', [defId]);
		await postgresql.query('DELETE FROM scc_aprv_default_user WHERE def_id = $1', [defId]);

		// 새로운 그룹 및 사용자 데이터 삽입
		for (const node of converted_gojs_data.nodeDataArray) {
			const groupInsertResult = await postgresql.query(insertGroupQuery, [
				defId,
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

			if (node.aprv_user_type === 0 && node.selectedapprovals && node.selectedapprovals.length > 0) {
				for (const approval of node.selectedapprovals) {
					const { name, seq, aprv_id, default_check } = approval;
					await postgresql.query(insertUserQuery, [defId, seq, aprv_id, default_check, group_id, name]);
				}
			}
		}

		// 트랜잭션 커밋
		await postgresql.query('COMMIT');

		res.status(200).json({
			message: 'Approval line and groups successfully updated or inserted',
			def_id: defId
		});
	} catch (err) {
		// 에러 발생 시 트랜잭션 롤백
		await postgresql.query('ROLLBACK');
		console.error('Error during transaction', err);
		res.status(500).json({
			message: 'Server error while updating or inserting approval line and groups',
			error: err.message
		});
	}
});

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

app.post('/test/checkUserBySeq', (req, res) => {
	const { def_id, seq } = req.body;
	const query = {
		text: "SELECT * FROM scc_aprv_default_user WHERE def_id = $1 AND seq = $2",
		values: [def_id, seq],
	};

	postgresql.query(query, (err, data) => {
		if (err) {
			return res.status(500).json({ message: 'Error checking user by seq' });
		} else if (data.rows.length === 0) {
			const data = {rows:[]}
			return res.status(200).json(data);
		} else {
			return res.status(200).json(data.rows);
		}
	});
});

app.post('/test/insertProcess', (req, res) => {
	const { title, info, input_id, aprv_id, aprv_line_depth, def_id, group_auth_id, aprv_user_type } = req.body;

	const insertProcessQuery = `
		INSERT INTO scc_aprv_process (
			title, info, status, del_flag, input_id, def_id, input_dt, module_name, status_dt, cancel_opinion, confirm_dt
		) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP, '', CURRENT_TIMESTAMP)
			RETURNING mis_id;
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

			// Get the current max seq from scc_aprv_route
			const getMaxSeqQuery = `SELECT COALESCE(MAX(seq), 0) as max_seq FROM scc_aprv_route WHERE mis_id = $1`;

			postgresql.query(getMaxSeqQuery, [mis_id], (err, result) => {
				if (err) {
					console.error('Error getting max seq:', err);
					postgresql.query('ROLLBACK', (rollbackErr) => {
						if (rollbackErr) {
							console.error('Transaction ROLLBACK error:', rollbackErr);
						}
					});
					return res.status(500).send('Error occurred while getting max seq.');
				}

				const maxSeq = result.rows[0].max_seq;
				const insertRoutePromises = [];

				for (let i = 0; i < aprv_line_depth; i++) {
					const seq = maxSeq + i + 1;
					const aprvIdValue = i === 0 ? aprv_id : '';

					// seq가 1이면 activity는 1, 그 외에는 2
					const activity = seq === maxSeq + 1 ? 1 : 2;

					// 마지막 route에 대해 return_seq는 -1, 그 외에는 seq + 1
					const return_seq = i === aprv_line_depth - 1 ? -1 : seq + 1;

					const insertRouteQuery = `
						INSERT INTO scc_aprv_route (
							mis_id, seq, activity, activity_dt, aprv_id, opinion, delegated, delegator,
							necessary, default_seq, alarm_send_result, auth_id, verify_query, read_dt,
							aprv_user_type, aprv_user_list, aprv_user_query, skip_check, skip_query, return_seq
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', $11, '', null, $12, '', '', null, '', $13);
					`;

					insertRoutePromises.push(
						postgresql.query(insertRouteQuery, [
							mis_id, seq, activity, null, aprvIdValue, '', 0, null, 0, seq, group_auth_id, aprv_user_type, return_seq
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
});

app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {
	const uid = req.params.uid; // URL 파라미터로부터 uid를 가져옵니다.

	// 첫 번째 쿼리 작성 (scc_aprv_default 테이블 조회)
	const query1 = {
		text: `
            SELECT * 
            FROM scc_aprv_default 
            WHERE range_group in (
                SELECT gid 
                FROM scc_user_groups
                WHERE uid = $1
            )`,
		values: [uid], // 첫 번째 파라미터로 uid 값을 넣습니다.
	};

	try {
		// 첫 번째 쿼리 실행
		const data1 = await postgresql.query(query1);
		// 데이터가 없을 경우 다른 쿼리 실행 후 그 결과 반환
		if (data1.rows.length === 0) {
			const fallbackQuery = {
				text: `
					SELECT 
						u.uid AS aprv_id, 
						u.uname AS user_name, 
						1 AS seq, 
						-1 AS user_id, 
						NULL AS group_name, 
						0 AS aprv_user_type, 
						-1 AS auth_id, 
						'' AS skip_query, 
						2 AS return_seq
					FROM scc_user u
					WHERE u.uid = $1`,
				values: [uid]
			};

			const fallbackData = await postgresql.query(fallbackQuery);

			return res.send({
				aprv_data: [], // 첫 번째 쿼리의 데이터는 없으므로 빈 배열로 반환
				approvals: fallbackData.rows
			});
		}

		const defId = data1.rows[0].def_id; // 첫 번째 쿼리에서 가져온 def_id 사용
		const query2 = {
			text: `SELECT
					   u.aprv_id, u.user_name, u.seq, u.user_id,
					   g.group_name, g.aprv_user_type, g.auth_id, g.skip_query, g.return_seq
				   FROM
					   scc_aprv_default_user u
						   JOIN
					   scc_aprv_default_group g
					   ON
						   u.group_id = g.group_id
				   WHERE u.def_id = $1 AND u.seq = 1`,
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
app.get('/test/aprvProcessExtractByInputAndStatus/:input_id/:status', async (req, res) => {
	const inputId = req.params.input_id;
	const status = req.params.status;

	const query = {
		text: `
			SELECT *
			FROM scc_aprv_process
			WHERE input_id = $1 AND status = $2
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

app.get('/test/getApprovalRoute/:mis_id', async (req, res) => {
	const mis_id = req.params.mis_id; // URL 파라미터로부터 mis_id를 가져옵니다.

	// scc_aprv_route 테이블에서 mis_id를 조건으로 데이터를 조회하는 쿼리 작성
	const query = {
		text: `
            SELECT * 
            FROM scc_aprv_route 
            WHERE mis_id = $1
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

// 결재 확인 (사용자가 결재할 요청 보는 화면)
app.post('/test/aprvProcessExtractByActivityAndAprvId', async (req, res) => {

	const { user_id } = req.body;
	const query = {
		text: `
			SELECT p.*, r.seq, r.activity
			FROM scc_aprv_process p
					 JOIN scc_aprv_route r ON p.mis_id = r.mis_id
			WHERE r.aprv_id = $1;
		`,
		values: [user_id],
	};

	try {
		const data = await postgresql.query(query,[user_id]);

		// 데이터가 없을 경우 빈 배열 반환
		if (data.rows.length === 0) {
			return res.send({
				res: []
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
app.post('/test/aprvProcessAprvId', async (req, res) => {

	const { user_id } = req.body;
	const query = {
		text: `
			SELECT *
			FROM scc_aprv_process p
			ON p.mis_id = r.mis_id
			WHERE r.aprv_id = $1
		`,
		values: [user_id],
	};

	try {
		const data = await postgresql.query(query,[user_id]);

		// 데이터가 없을 경우 빈 배열 반환
		if (data.rows.length === 0) {
			return res.send({
				res: []
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

// route 결재 진행
app.post('/test/updateRoute', async (req, res) => {
	const { mis_id, def_id, seq, activity, user_id, next_approval_id, info } = req.body; // 요청 본문에서 필요한 값들 추출

	// SQL 쿼리 1: 현재 라우트를 찾고 업데이트하는 쿼리
	const findCurrentRouteQuery = `
		SELECT * FROM scc_aprv_route
		WHERE mis_id = $1 AND aprv_id = $2
	`;

	// SQL 쿼리 2: 현재 라우트를 업데이트하는 쿼리 (activity, activity_dt 값 업데이트, opinion 포함)
	const updateCurrentRouteQueryWithOpinion = `
		UPDATE scc_aprv_route
		SET activity = $1, opinion = $2, activity_dt = CURRENT_TIMESTAMP
		WHERE mis_id = $3 AND aprv_id = $4
			RETURNING *;
	`;

	const updateCurrentRouteQuery = `
		UPDATE scc_aprv_route
		SET activity = $1, activity_dt = CURRENT_TIMESTAMP
		WHERE mis_id = $2 AND aprv_id = $3
			RETURNING *;
	`;

	// SQL 쿼리 3: 다음 라우터를 찾는 쿼리
	const findNextRouteQuery = `
		SELECT * FROM scc_aprv_route
		WHERE mis_id = $1 AND seq = $2
	`;

	// SQL 쿼리 4: 다음 라우트를 업데이트하는 쿼리
	const updateNextRouteQuery = `
		UPDATE scc_aprv_route
		SET activity = 1, aprv_id = $1
		WHERE mis_id = $2 AND seq = $3
			RETURNING *;
	`;

	// SQL 쿼리 5: scc_aprv_process 테이블에서 status_dt 업데이트
	const updateProcessStatusQuery = `
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

	try {
		await postgresql.query('BEGIN');

		// 현재 라우트 업데이트
		const currentRouteResult = await postgresql.query(findCurrentRouteQuery, [mis_id, user_id]);
		if (currentRouteResult.rowCount === 0) {
			throw new Error('No matching route found for the current user.');
		}

		if (activity === 4) {
			// scc_aprv_route 테이블 업데이트 (opinion 포함)
			await postgresql.query(updateCurrentRouteQueryWithOpinion, [activity, info, mis_id, user_id]);

			// scc_aprv_process 테이블의 cancel_opinion에 opinion 값 저장
			await postgresql.query(updateProcessCancelOpinionQuery, [info, mis_id]);
		} else {
			await postgresql.query(updateCurrentRouteQuery, [activity, mis_id, user_id]);
		}

		// scc_aprv_process 테이블의 status_dt 업데이트
		await postgresql.query(updateProcessStatusQuery, [mis_id]);

		// 다음 라우터 찾기
		const nextRouteResult = await postgresql.query(findNextRouteQuery, [mis_id, seq + 1]);

		if (nextRouteResult.rowCount === 0) {
			// 마지막 라우터일 경우
			await postgresql.query('COMMIT');
			return res.status(200).json({
				message: 'Current route updated, no next route available.',
				isLastRoute: true // 마지막 라우터임을 표시
			});
		}

		// 다음 라우트 업데이트
		await postgresql.query(updateNextRouteQuery, [next_approval_id, mis_id, seq + 1]);

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
