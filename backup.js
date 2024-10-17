// PostgreSQL 쿼리 실행
// postgresql.query(insertDefaultQuery, (err, result) => {
//     if (err) {
//         console.log(err);
//         res.status(500).send('Error occurred while inserting into the database.');
//     } else {
//         res.status(201).send({ message: 'Data inserted and updated successfully.' })
        // const def_id = result.rows[0].def_id;  // 삽입된 def_id 가져오기
        //
        // // nodeDataArray에 def_id를 포함한 새로운 객체 생성
        // const updatedGojsData = {
        // 	class: "GraphLinksModel",
        // 	modelData: {
        // 		canRelink: true
        // 	},
        // 	linkDataArray: [],
        // 	nodeDataArray: [
        // 		{
        // 			def_id: def_id,  // 여기서 가져온 def_id 사용
        // 			group_name: '사용자 그룹',
        // 			seq: 2,
        // 			aprv_user_type: 0,
        // 			aprv_group: 1,
        // 			aprv_user_query: "",
        // 			auth_id: 1,
        // 			verify_query: "",
        // 			aprv_skip: 0,
        // 			skip_query: "",
        // 			return_seq: 0,
        //
        // 			// 자체 추가
        // 			key: sk,
        // 			loc: '300 250',
        // 			name: '사용자 그룹',
        // 			groups: null,
        // 			category: '0',
        // 			group_id: sk,
        // 			line_name: line_name,
        // 			line_depth: 1,
        // 			verify_query_sql: "",
        // 			selected_group_id: null,
        // 			selectedapprovals: null,
        // 		}
        // 	],
        // 	linkKeyProperty: "key"
        // };
        //
        // // 두 번째 쿼리: scc_aprv_default 테이블의 gojs_data 업데이트
        // const updateGojsDataQuery = {
        // 	text: `UPDATE scc_aprv_default SET gojs_data = $1 WHERE def_id = $2`,
        // 	values: [updatedGojsData, def_id],
        // };
        //
        // postgresql.query(updateGojsDataQuery, (err, result) => {
        // 	// console.log(result)
        // 	if (err) {
        // 		console.log(err);
        // 		res.status(500).send('Error occurred while updating the gojs_data.');
        // 	} else {
        // 		res.status(201).send({ message: 'Data inserted and updated successfully.' });
        // 	}
        // });
//     }
// });