recursiveRouteInit: `
            WITH RECURSIVE ReverseRouteUpdate AS (
                SELECT ag_num, next_ag_num, return_ag_num
                FROM scc_aprv_route WHERE ag_num = $1
                UNION ALL
                SELECT r.ag_num, r.next_ag_num, r.return_ag_num
                FROM scc_aprv_route r
                INNER JOIN ReverseRouteUpdate ru ON r.ag_num = ru.return_ag_num
                WHERE ru.return_ag_num != $2
            )
            UPDATE scc_aprv_route
            SET activity = CASE WHEN return_ag_num = $2 THEN 1 ELSE 2 END,
                opinion = CASE WHEN return_ag_num = $2 THEN opinion ELSE '' END
            WHERE ag_num IN (SELECT ag_num FROM ReverseRouteUpdate) OR ag_num = $1;
        `,