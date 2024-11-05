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

app.use(cors()); // cors 미들웨어
app.use(express.json());

const HOST = '192.168.10.104'; // 로컬 IP 기본값
const PORT = 8081;

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

// 결재선 추가
app.post('/test/insertProcess', (req, res) => {
	const { title, info, input_id, aprv_id, def_id, group_auth_id, aprv_user_type } = req.body;

	const selectDefaultGroupByDefIdQuery = `
		SELECT g.group_id, g.group_name, g.seq FROM scc_aprv_default_group g WHERE def_id = $1 ORDER BY seq ASC, group_id ASC
	`;

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
					const seq = group.seq;
					const aprvIdValue = index === 0 ? aprv_id : '';
					const activity = index === 0 ? 1 : 2;
					const return_seq = index === groups.length - 1 ? -1 : group.seq+1;

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

// 결재선 컨펌 데이트 업데이트
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

// 결재선 추가 및 수정 시 결재선과 결재 그룹 저장 및 수정 하는 api
app.post('/test/updateOrInsertAprv/:def_id', async (req, res) => {
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
					const { name, aprv_id, default_check } = approval;
					console.log(node)
					console.log(approval)
					// 노드 변경시 결재자의 seq도 바뀌기 위해 노드 시퀀스 삽입
					await postgresql.query(insertUserQuery, [defId, node.seq, aprv_id, default_check, group_id, name]);
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

// 특정 결재선의 range_group column 중복 여부 확인 API
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

// 결재선 삭제
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

// 결재 그룹 내 결재자 get api
app.post('/test/checkUserBySeq', (req, res) => {
	const { def_id, seq } = req.body;

	const aprvTypeQuery = {
		text: "SELECT du.*, u.uname FROM scc_aprv_default_user du JOIN scc_user u ON du.aprv_id = u.uid WHERE def_id = $1 AND seq = $2",
		values: [def_id, seq],
	};

	const groupTypeQuery = {
		text: `SELECT ug.uid as aprv_id, udg.auth_id, udg.seq, udg.aprv_user_type,
					  udg.skip_query, udg.return_seq, u.uname
			   FROM scc_user_groups ug
						JOIN scc_aprv_default_group udg ON ug.gid = udg.aprv_group
						JOIN scc_user u ON ug.uid = u.uid
			   WHERE udg.def_id = $1 AND udg.seq = $2`,
		values: [def_id, seq],
	};

	// 쿼리 타입 작업 예정 1
	const queryTypeQuery = {
		text: ``,
		values: [def_id, seq],
	};

	postgresql.query(aprvTypeQuery, (err, aprvTypeData) => {
		if (err) {
			return res.status(500).json({ message: 'Error checking user by seq' });
		}

		const aprvTypeNextAprv = aprvTypeData.rows.length > 0 ? aprvTypeData.rows : [];

		postgresql.query(groupTypeQuery, (groupErr, groupTypeData) => {
			if (groupErr) {
				return res.status(500).json({ message: 'Error checking group by seq' });
			}

			const groupTypeNextAprv = groupTypeData.rows.length > 0 ? groupTypeData.rows : [];

			return res.status(200).json({
				aprvTypeNextAprv,
				groupTypeNextAprv
			});
		});
	});
});

// 로그인된 사용자 id로 생성된 결재선에서 결재선 정보와 결재선 내 한 그룹의 결재자 리스트 가져오는 api
app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {
	const uid = req.params.uid; // URL 파라미터로부터 uid를 가져옵니다.

	// 로그인 사용자의 그룹 포함 여부에 따른 결재선 선택 쿼리 -> 다른 사용자가 만든 결재선을 선택하게 된다.
	const aprvLineSelectQuery = {
		text: `
			SELECT *
			FROM scc_aprv_default
			WHERE range_group in (
				SELECT gid
				FROM scc_user_groups
				WHERE uid = $1
			)
			order by def_id desc
			LIMIT 1
			`,
		values: [uid], // 첫 번째 파라미터로 uid 값을 넣습니다.
	};

	const AllAprvLineSelectQuery = {
		text: `
			SELECT *
			FROM scc_aprv_default
			WHERE range_group = -1`,
	};

	try {
		// 첫 번째 쿼리 실행
		let aprvLineData = await postgresql.query(aprvLineSelectQuery);

		// 데이터가 없을 경우 AllAprvLineSelectQuery 실행
		if (aprvLineData.rows.length === 0) {
			aprvLineData = await postgresql.query(AllAprvLineSelectQuery);
		}

		// 여전히 데이터가 없을 경우 404 반환
		// if (aprvLineData.rows.length === 0) {
		// 	return res.status(404).send("결재선이 존재하지 않습니다.");
		// }

		const aprvLineDefId = aprvLineData.rows[0].def_id; // 첫 번째 쿼리에서 가져온 def_id 사용

		// 첫번째 시퀀스의 결재 그룹의 타입이 0번인 경우
		const aprvLineTypeAprvQuery = {
			text: `SELECT
               u.aprv_id, u.user_name, u.seq, u.user_id,
               g.group_name, g.aprv_user_type, g.auth_id, g.skip_query, g.return_seq,
               su.uname
           FROM
               scc_aprv_default_user u
               JOIN scc_aprv_default_group g ON u.group_id = g.group_id
               JOIN scc_user su ON u.aprv_id = su.uid
           WHERE u.def_id = $1 AND u.seq = 1`,
			values: [aprvLineDefId], // 첫 번째 쿼리 결과에서 얻은 def_id 값을 사용
		};

		const aprvLineTypeAprvData = await postgresql.query(aprvLineTypeAprvQuery);

		// aprvLineTypeAprvQuery의 결과가 없을 경우 groupQuery 실행
		let approvals;
		if (aprvLineTypeAprvData.rows.length === 0) {
			const aprvLineTypeGroupQuery = {
				text: `SELECT ug.uid as aprv_id, udg.auth_id, udg.seq, udg.aprv_user_type,
							  udg.skip_query, udg.return_seq, u.uname
					   FROM scc_user_groups ug
								JOIN scc_aprv_default_group udg ON ug.gid = udg.aprv_group
								JOIN scc_user u ON ug.uid = u.uid
					   WHERE udg.def_id = $1
						 AND udg.seq = 1`,
				values: [aprvLineDefId] // 첫 번째 쿼리 결과에서 얻은 def_id 값을 사용
			};

			const aprvLineTypeGroupData = await postgresql.query(aprvLineTypeGroupQuery);

			approvals = aprvLineTypeGroupData.rows;
		} else {
			approvals = aprvLineTypeAprvData.rows;
		}

		// 결과 반환
		res.send({
			aprv_data: aprvLineData.rows,
			approvals: approvals
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
			ORDER BY seq ASC
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
app.post('/test/getApprovalByAprvIdAndMisId', async (req, res)=> {
	const {user_id, mis_id} = req.body;

	const query = {
		text: `
 			select r.seq, r.activity 
 			from scc_aprv_route r
            WHERE r.aprv_id = $1 AND r.mis_id = $2 AND r.activity = 1
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
	const { user_id, status } = req.body;

	// status 값에 따라 p.status와 r.activity 조건 설정
	let statusCondition;
	let activityCondition;

	if (status === 0) { // 결재 예정
		statusCondition = `(p.status = 0 OR p.status = 1)`;
		activityCondition = `r.activity = 1`;
	}
	else if (status === 1) { // 결재 진행 완료
		statusCondition = `(p.status = 1)`;
		activityCondition = `r.activity = 3`;
	}
	else if (status === 2) { // 전체 결재 완료
		statusCondition = `p.status = 2`;
		activityCondition = `r.activity = 3`;
		// 결재자와 액티비티가 같은 row가 2개 이상 있는 경우로 인해 프로세스 중복해서 가져오는 오류 있음
	} else if (status === 3) {  // 결재 반려
		statusCondition = `p.status = 3`;
		activityCondition = `r.activity = 4`;
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
              AND ${activityCondition};
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

// 결재 상세 확인 (사용자가 결재할 요청 보는 화면)
app.post('/test/aprvProcessExtractByActivityAndAprvIdAndMisId', async (req, res) => {

	const { user_id,status,misId } = req.body;
	const query = {
		text: `
			SELECT p.*, r.seq, r.activity
			FROM scc_aprv_process p
					 JOIN scc_aprv_route r ON p.mis_id = r.mis_id
			WHERE r.aprv_id = $1 and p.status = $2 and p.mis_id = $3;
		`,
		values: [user_id,status,misId],
	};

	try {
		const data = await postgresql.query(query,[user_id,status,misId]);

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

// route 결재 진행
app.post('/test/updateRoute', async (req, res) => {
	const { mis_id, def_id, seq, activity, user_id, next_approval_id, info } = req.body; // 요청 본문에서 필요한 값들 추출

	// SQL 쿼리 1: 현재 라우트를 찾고 업데이트하는 쿼리
	const findCurrentRouteQuery = `
        SELECT * FROM scc_aprv_route
        WHERE mis_id = $1 AND aprv_id = $2 AND seq = $3
    `;

	// SQL 쿼리 2: 현재 라우트를 업데이트하는 쿼리 (activity, opinion, activity_dt 값 업데이트, )
	const updateCurrentRouteQuery = `
        UPDATE scc_aprv_route
        SET activity = $1, opinion = $2, activity_dt = CURRENT_TIMESTAMP
        WHERE mis_id = $3 AND aprv_id = $4 AND seq = $5
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

	// SQL 쿼리 7: scc_aprv_process 테이블의 status 값 업데이트
	const updateProcessStatusValueQuery = `
        UPDATE scc_aprv_process
        SET status = $1, status_dt = CURRENT_TIMESTAMP
        WHERE mis_id = $2
    `;

	// SQL 쿼리 8: 모든 route의 activity 상태 확인
	const checkAllRoutesActivityQuery = `
        SELECT COUNT(*)::INTEGER as total_routes, 
               SUM(CASE WHEN activity = 3 THEN 1 ELSE 0 END)::INTEGER as completed_routes
        FROM scc_aprv_route
        WHERE mis_id = $1
    `;

	// SQL 쿼리 9: activity가 4인 row가 있는지 확인하는 쿼리
	const checkActivity4ExistsQuery = `
        SELECT COUNT(*)::INTEGER as count
        FROM scc_aprv_route
        WHERE mis_id = $1 AND activity = 4
    `;

	try {
		await postgresql.query('BEGIN');

		// 현재 라우트 업데이트
		const currentRouteResult = await postgresql.query(findCurrentRouteQuery, [mis_id, user_id, seq]);
		if (currentRouteResult.rowCount === 0) {
			throw new Error('No matching route found for the current user.');
		}

		if (activity === 4) {
			// scc_aprv_route 테이블 업데이트
			await postgresql.query(updateCurrentRouteQuery, [activity, info, mis_id, user_id, seq]);

			// scc_aprv_process 테이블의 cancel_opinion에 opinion 값 저장
			await postgresql.query(updateProcessCancelOpinionQuery, [info, mis_id]);

			// status 값을 3으로 업데이트 (activity가 4인 경우)
			await postgresql.query(updateProcessStatusValueQuery, [3, mis_id]);
		} else {
			await postgresql.query(updateCurrentRouteQuery, [activity, info, mis_id, user_id, seq]);
		}

		// scc_aprv_process 테이블의 status_dt 업데이트
		await postgresql.query(updateProcessStatusQuery, [mis_id]);

		// 모든 route의 상태 확인
		const allRoutesStatus = await postgresql.query(checkAllRoutesActivityQuery, [mis_id]);
		const { total_routes, completed_routes } = allRoutesStatus.rows[0];

		// activity가 4인 row가 있는지 확인
		const activity4Exists = await postgresql.query(checkActivity4ExistsQuery, [mis_id]);
		const hasActivity4 = activity4Exists.rows[0].count > 0;

		if (!hasActivity4) {
			await postgresql.query(updateProcessStatusValueQuery, [1, mis_id]);
		}

		if (completed_routes === 1 && activity === 3) {
			await postgresql.query(updateProcessStatusValueQuery, [1, mis_id]);
		} else if (completed_routes === total_routes) {
			await postgresql.query(updateProcessStatusValueQuery, [2, mis_id]);
		}

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
