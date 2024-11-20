app.get('/test/aprvDefaultExtractOneGroup/:uid', async (req, res) => {
    const uid = req.params.uid;

    console.log(uid);

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
                       u.aprv_id, u.user_name, u.ag_num, u.user_id,
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

        if (aprvLineTypeAprvData.rows.length > 0) {
            // 첫 번째 유형 쿼리에서 결과가 있으면 이후 진행 중단
            return res.send({ aprv_data: aprvLineData.rows, approvals: aprvLineTypeAprvData.rows });
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
