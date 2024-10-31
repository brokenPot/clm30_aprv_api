app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {

    const uid = req.params.uid; // URL 파라미터로부터 uid를 가져옵니다.

    // 로그인 사용자의 그룹 포함 여부에 따른 결재선 선택 쿼리
    const aprvLineSelectQuery = {
        text: `
			SELECT * 
			FROM scc_aprv_default 
			WHERE range_group IN (
				COALESCE(
					(SELECT gid FROM scc_user_groups WHERE uid = $1 LIMIT 1), -1
				)
			) LIMIT 1`,
        values: [uid], // 첫 번째 파라미터로 uid 값을 넣습니다.
    };

    try {
        // 첫 번째 쿼리 실행
        const aprvLineData = await postgresql.query(aprvLineSelectQuery);
        console.log("aprvLineData : ",aprvLineData.rows)
        // 데이터가 없을 경우 다른 쿼리 실행 후 그 결과 반환
        if (aprvLineData.rows.length === 0) {
            return res.status(404).send("결재선이 존재하지 않습니다.");
            // const fallbackQuery = {
            //     text: `
			// 		SELECT
			// 			u.uid AS aprv_id,
			// 			u.uname AS user_name,
			// 			1 AS seq,
			// 			-1 AS user_id,
			// 			NULL AS group_name,
			// 			0 AS aprv_user_type,
			// 			-1 AS auth_id,
			// 			'' AS skip_query,
			// 			2 AS return_seq
			// 		FROM scc_user u
			// 		WHERE u.uid = $1`,
            //     values: [uid]
            // };
            //
            // const fallbackData = await postgresql.query(fallbackQuery);
            //
            // return res.send({
            //     aprv_data: [], // 첫 번째 쿼리의 데이터는 없으므로 빈 배열로 반환
            //     approvals: fallbackData.rows
            // });
        }

        const aprvLineDefId = aprvLineData.rows[0].def_id; // 첫 번째 쿼리에서 가져온 def_id 사용

        // 첫번째 시퀀스의 결재 그룹의 타입이 0번인 경우
        const aprvLineTypeAprvQuery = {
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
            values: [aprvLineDefId], // 첫 번째 쿼리 결과에서 얻은 def_id 값을 사용
        };

        const aprvLineTypeAprvData = await postgresql.query(aprvLineTypeAprvQuery);
        console.log("aprvLineTypeAprvData : ", aprvLineTypeAprvData)

        // query2의 결과가 없을 경우 groupQuery 실행
        let approvals;
        if (aprvLineTypeAprvData.rows.length === 0) {
            const aprvLineTypeGroupQuery = {
                text: `SELECT ug.uid as aprv_id, udg.auth_id, udg.seq,udg.aprv_user_type,udg.skip_query,udg.return_seq
					   FROM scc_user_groups ug
								JOIN
							scc_aprv_default_group udg
							ON
								ug.gid = udg.aprv_group
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
