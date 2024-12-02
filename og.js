app.post('/test/updateCurrentUserRoute',async (req, res)=>{
    const {mis_id, ag_num, activity, user_id, opinion, next_ag_num, return_ag_num, aprv_id} = req.body;
    // activity가 5번, 반려인 경우의 api가 필요하다. 쿼리 진행후 해당 mis_id의 process는 status가 3번이 되어있을 것이다
    // activity 4번, 취소의 경우 api 수정이 필요하다. 쿼리 진행후 해당 mis_id의 process는 status가 4번이 되어있을 것이다


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

    // SQL 쿼리 10: activity가 4인 row의 ag_num을 기준으로 이전 row들을 초기화 하는 쿼리
    const recursiveRouteInitQuery = `
        WITH RECURSIVE ReverseRouteUpdate AS (
            -- 초기 ag_num 선택
            SELECT
                ag_num,
                next_ag_num,
                return_ag_num
            FROM scc_aprv_route
            WHERE ag_num = $1  -- 마지막 노드 입력 (예: 5)

            UNION ALL

            -- return_ag_num을 따라 이전 노드 탐색
            SELECT
                r.ag_num,
                r.next_ag_num,
                r.return_ag_num
            FROM scc_aprv_route r
                     INNER JOIN ReverseRouteUpdate ru
                                ON r.ag_num = ru.return_ag_num
            WHERE ru.return_ag_num != $2 -- return_ag_num = $2인 노드는 제외
            )
-- 첫 번째 ag_num 행과 그 이전 노드들의 초기화 (activity = 2, opinion = '')
        UPDATE scc_aprv_route
        SET
            activity = 2,  -- 초기화 조건
            opinion = ''   -- 초기화 조건
        WHERE ag_num IN (SELECT ag_num FROM ReverseRouteUpdate);

-- return_ag_num이 $2인 노드는 activity만 1로 업데이트
        UPDATE scc_aprv_route
        SET
            activity = 1
        WHERE ag_num IN (
            SELECT ag_num
            FROM scc_aprv_route
            WHERE return_ag_num = $2
        );

-- 인자로 들어간 ag_num도 opinion을 초기화
        UPDATE scc_aprv_route
        SET
            opinion = ''  -- 초기화
        WHERE ag_num = $1;
    `;

    // SQL 쿼리 11: activity가 5(반려)인 row의 ag_num과 mis_id값을 넣어 scc_aprv_return_history에 데이터 저장
    const InsertAprvReturnHistoryQuery = `
        INSERT INTO scc_aprv_process (mis_id, ag_num, return_ag_num, aprv_id, opinion, return_cnt, return_dt)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP )
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

            // 다음 라우트를 따라가며 초기화하는 쿼리 실행
            // await postgresql.query(recursiveRouteInitQuery, [ag_num]);

            // scc_aprv_process 테이블의 cancel_opinion에 opinion 값 저장
            await postgresql.query(updateProcessCancelOpinionQuery, [opinion, mis_id]);

            // scc_aprv_process 테이블의 status 값을 4(상신취소)으로 업데이트 (activity가 4인 경우)
            await postgresql.query(updateProcessStatusValueQuery, [4, mis_id]);
        }
        // 현재 로그인한 사용자가 결재 반려 하는 경우
        else if (activity === 5) {
            console.log('반려 진입')
            // scc_aprv_route 테이블 업데이트
            await postgresql.query(updateCurrentRouteQuery, [2, opinion, mis_id, user_id, ag_num]);
            console.log('scc_aprv_route 테이블 업데이트 통과')
            // 다음 라우트를 따라가며 초기화하는 쿼리 실행
            await postgresql.query(recursiveRouteInitQuery, [ag_num,return_ag_num]);
            console.log('scc_aprv_route 라우트 초기화 통과')
            // scc_aprv_return_history에 현재 row 값 저장
            await postgresql.query(InsertAprvReturnHistoryQuery, [mis_id, ag_num, return_ag_num, aprv_id, opinion, 0]); // return_cnt 일단 0으로 저장
            console.log('실패 추정')
            // scc_aprv_process 테이블의 status 값을 3(반려)으로 업데이트 (activity가 5인 경우)
            await postgresql.query(updateProcessStatusValueQuery, [3, mis_id]);




        }

        else {
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
        console.error("에러 메세지 :", err.message);
        res.status(500).json({
            message: 'Server error while updating route data',
            error: err.message
        });
    }
})
