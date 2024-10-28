app.post('/test/updateRoute', async (req, res) => {
    const { mis_id, def_id, seq, activity, user_id, next_approval_id, info } = req.body;

    // 필요한 SQL 쿼리 정의
    const queries = {
        // SQL 쿼리 1: 현재 라우트를 찾고 업데이트하는 쿼리
        findCurrentRoute: `
      SELECT * FROM scc_aprv_route
      WHERE mis_id = $1 AND aprv_id = $2
    `,
        // SQL 쿼리 2: 현재 라우트를 업데이트하는 쿼리 (activity, activity_dt 값 업데이트, opinion 포함)
        updateCurrentRouteWithOpinion: `
      UPDATE scc_aprv_route
      SET activity = $1, opinion = $2, activity_dt = CURRENT_TIMESTAMP
      WHERE mis_id = $3 AND aprv_id = $4
      RETURNING *;
    `,
        updateCurrentRoute: `
      UPDATE scc_aprv_route
      SET activity = $1, activity_dt = CURRENT_TIMESTAMP
      WHERE mis_id = $2 AND aprv_id = $3
      RETURNING *;
    `,
        // SQL 쿼리 3: 다음 라우터를 찾는 쿼리
        findNextRoute: `
      SELECT * FROM scc_aprv_route
      WHERE mis_id = $1 AND seq = $2
    `,
        // SQL 쿼리 4: 다음 라우트를 업데이트하는 쿼리
        updateNextRoute: `
      UPDATE scc_aprv_route
      SET activity = 1, aprv_id = $1
      WHERE mis_id = $2 AND seq = $3
      RETURNING *;
    `,
        // SQL 쿼리 5: scc_aprv_process 테이블에서 status_dt 업데이트
        updateProcessStatus: `
      UPDATE scc_aprv_process
      SET status_dt = CURRENT_TIMESTAMP
      WHERE mis_id = $1
    `,
        // SQL 쿼리 6: scc_aprv_process 테이블의 cancel_opinion 칼럼 업데이트
        updateProcessCancelOpinion: `
      UPDATE scc_aprv_process
      SET cancel_opinion = $1
      WHERE mis_id = $2
    `,
        // SQL 쿼리 7: scc_aprv_process 테이블의 status 값 업데이트
        updateProcessStatusValue: `
      UPDATE scc_aprv_process
      SET status = $1, status_dt = CURRENT_TIMESTAMP
      WHERE mis_id = $2
    `,
        // SQL 쿼리 8: 모든 route의 activity 상태 확인
        checkAllRoutesActivity: `
      SELECT COUNT(*)::INTEGER as total_routes, 
             SUM(CASE WHEN activity = 3 THEN 1 ELSE 0 END)::INTEGER as completed_routes
      FROM scc_aprv_route
      WHERE mis_id = $1
    `,
        // SQL 쿼리 9: activity가 4인 row가 있는지 확인하는 쿼리
        checkActivity4Exists: `
      SELECT COUNT(*)::INTEGER as count
      FROM scc_aprv_route
      WHERE mis_id = $1 AND activity = 4
    `
    };

    // 현재 라우트를 업데이트하는 함수
    const updateCurrentRoute = async (activity, info) => {
        if (activity === 4) {
            await postgresql.query(queries.updateCurrentRouteWithOpinion, [activity, info, mis_id, user_id]);
            await postgresql.query(queries.updateProcessCancelOpinion, [info, mis_id]);
            await postgresql.query(queries.updateProcessStatusValue, [3, mis_id]);
        } else {
            await postgresql.query(queries.updateCurrentRoute, [activity, mis_id, user_id]);
        }
    };

    // 프로세스 상태를 업데이트하는 함수
    const updateProcessStatus = async () => {
        await postgresql.query(queries.updateProcessStatus, [mis_id]);
        const allRoutesStatus = await postgresql.query(queries.checkAllRoutesActivity, [mis_id]);
        const { total_routes, completed_routes } = allRoutesStatus.rows[0];

        const activity4Exists = await postgresql.query(queries.checkActivity4Exists, [mis_id]);
        const hasActivity4 = activity4Exists.rows[0].count > 0;

        if (!hasActivity4) {
            await postgresql.query(queries.updateProcessStatusValue, [1, mis_id]);
        }

        if (completed_routes === 1 && activity === 3) {
            await postgresql.query(queries.updateProcessStatusValue, [1, mis_id]);
        } else if (completed_routes === total_routes) {
            await postgresql.query(queries.updateProcessStatusValue, [2, mis_id]);
        }
    };

    try {
        await postgresql.query('BEGIN');

        // 현재 라우트 업데이트
        const currentRouteResult = await postgresql.query(queries.findCurrentRoute, [mis_id, user_id]);
        if (currentRouteResult.rowCount === 0) {
            throw new Error('No matching route found for the current user.');
        }

        await updateCurrentRoute(activity, info);
        await updateProcessStatus();

        // 다음 라우터 찾기
        const nextRouteResult = await postgresql.query(queries.findNextRoute, [mis_id, seq + 1]);

        if (nextRouteResult.rowCount === 0) {
            await postgresql.query('COMMIT');
            return res.status(200).json({
                message: 'Current route updated, no next route available.',
                isLastRoute: true
            });
        }

        // 다음 라우트 업데이트
        await postgresql.query(queries.updateNextRoute, [next_approval_id, mis_id, seq + 1]);
        await postgresql.query('COMMIT');

        res.status(200).json({
            message: 'Current and next route successfully updated.',
            isLastRoute: false
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
