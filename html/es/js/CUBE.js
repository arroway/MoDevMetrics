/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


if (CUBE===undefined) var CUBE = {};



importScript("CNV.js");
importScript("aDate.js");
importScript("aUtil.js");
importScript("debug/aLog.js");
importScript("MVEL.js");
importScript("CUBE.aggregate.js");
importScript("CUBE.column.js");
importScript("CUBE.cube.js");
importScript("CUBE.domain.js");
importScript("CUBE.analytic.js");

importScript("../lib/jsThreads/js/thread.js");

var Q;   //=Q


(function(){

	var DEBUG=true;


CUBE.compile = function(query, sourceColumns, useMVEL){
//COMPILE COLUMN CALCULATION CODE
	var columns = [];
	var uniqueColumns={};

	if (query.edges === undefined) query.edges=[];

	var edges = query.edges;
	for(var g = 0; g < edges.length; g++){
		var e=edges[g];

		if (typeof(e)=='string'){
			e={"value":e}; //NOW DEFINE AN EDGE BY ITS VALUE
			edges[g]=e;
		}//endif
		if (e.name===undefined) e.name=e.value;
		if (e.allowNulls === undefined) e.allowNulls = false;
		e.columnIndex=g;

		if (uniqueColumns[e.name]!==undefined) Log.error("All edges must have different names");
		columns[e.columnIndex] = e;
		uniqueColumns[e.name]=e;

		//EDGES DEFAULT TO A STRUCTURED TYPE, OTHER COLUMNS DEFAULT TO VALUE TYPE
		if (e.domain === undefined) e.domain={"type":"default"};
		CUBE.column.compile(e, sourceColumns, undefined, useMVEL);
		e.outOfDomainCount = 0;
	}//for


	if (!(query.select instanceof Array)){
		if (typeof(query.select)=="string") query.select={"value":query.select};
	}//endif

	var select = Array.newInstance(query.select);
	for(var s = 0; s < select.length; s++){
		if (typeof(select[s])=="string") select[s]={"value":select[s]};
		if (select[s].name===undefined) select[s].name=select[s].value.split(".").last();
		if (uniqueColumns[select[s].name]!==undefined) Log.error("All columns must have different names");
		select[s].columnIndex=s+edges.length;
		columns[select[s].columnIndex] = select[s];
		uniqueColumns[select[s].name] = select[s];
		CUBE.column.compile(select[s], sourceColumns, edges, useMVEL);
		CUBE.aggregate.compile(select[s]);
	}//for

	query.columns=columns;
	return columns;
};

//MAP SELECT CLAUSE TO AN ARRAY OF SELECT COLUMNS
Array.newInstance = function(select){
	if (select === undefined) return [];
	if (!(select instanceof Array)) return [select];
	return select;
};//method




function getAggregate(result, query, select){
	//WE NEED THE select TO BE AN ARRAY
	var edges=query.edges;

	//FIND RESULT IN tree
	var agg = query.tree;
	var i = 0;
	for(; i < edges.length - 1; i++){
		var part=result[i];
		var v = edges[i].domain.getKey(part);
		if (agg[v] === undefined) agg[v] = {};
		agg = agg[v];
	}//for



	part=result[i];
	v = edges[i].domain.getKey(part);
	if (agg[v] === undefined){
		agg[v]=[];
		//ADD SELECT DEFAULTS
		for(var s = 0; s < select.length; s++){
			agg[v][s] = select[s].defaultValue();
		}//for
	}//endif

	return agg[v];
}//method


function calcAgg(row, result, query, select){
	var agg = getAggregate(result, query, select);
	for(var s = 0; s < select.length; s++){
		//ADD TO THE AGGREGATE VALUE
		agg[s] = select[s].aggFunction(row, result, agg[s]);
	}//endif
}//method


function calc2Tree(query){
	if (query.edges.length == 0)
		Log.error("Tree processing requires an edge");
	if (query.where=="bug!=null")
		Log.note("");

	var sourceColumns  = yield (CUBE.getColumnsFromQuery(query));
	if (sourceColumns===undefined){
		Log.error("Can not get column definitions from query:\n"+CNV.Object2JSON(query).indent(1))
	}//endif
	var from = query.from.list;

	var edges = query.edges;
	query.columns = CUBE.compile(query, sourceColumns);
	var select = Array.newInstance(query.select);
	var where = CUBE.where.compile(query.where, sourceColumns, edges);
	var numWhereFalse=0;


	var tree = {};
	query.tree = tree;
	FROM: for(var i = 0; i < from.length; i++){
		yield (Thread.yield());

		var row = from[i];
		//CALCULATE THE GROUP COLUMNS TO PLACE RESULT
		var results = [[]];
		for(var f = 0; f < edges.length; f++){
			var edge = edges[f];


			if (edge.test || edge.range){
				//MULTIPLE MATCHES EXIST
				let matches= edge.domain.getMatchingParts(row);

				if (matches.length == 0){
					edge.outOfDomainCount++;
					if (edge.allowNulls){
						for(let t = results.length; t--;){
							results[t][f] = edge.domain.NULL;
						}//for
					} else{
						continue FROM;
					}//endif
				} else{
					//WE MULTIPLY THE NUMBER OF MATCHES TO THE CURRENT NUMBER OF RESULTS (SQUARING AND CUBING THE RESULT-SET)
					for(let t = results.length; t--;){
						result = results[t];
						result[f] = matches[0];
						for(var p = 1; p < matches.length; p++){
							result = result.copy();
							results.push(result);
							result[f] = matches[p];
						}//for
					}//for
				}//endif
			} else{
				var v = edge.calc(row, null);

				//STANDARD 1-1 MATCH VALUE TO DOMAIN
				var p = edge.domain.getPartByKey(v);
				if (p === undefined){
					Log.error("getPartByKey() must return a partition, or null");
				}//endif
				if (p == edge.domain.NULL){
					edge.outOfDomainCount++;
					if (edge.allowNulls){
						for(let t = results.length; t--;){
							results[t][f] = edge.domain.NULL;
						}//for
					} else{
						continue FROM;
					}//endif
				} else{
					for(let t = results.length; t--;) results[t][f] = p;
				}//endif
			}//endif
		}//for


		for(var r = results.length; r--;){
			var pass = where(row, results[r]);
			if (pass){
				calcAgg(row, results[r], query, select);
			}else{
				numWhereFalse++;
			}//for
		}//for

	}//for

	for(var g = 0; g < edges.length; g++){
		if (edges[g].outOfDomainCount > 0)
			Log.warning(edges[g].name + " has " + edges[g].outOfDomainCount + " records outside domain " + edges[g].domain.name);
	}//for
	if (DEBUG) Log.note("Where clause rejected "+numWhereFalse+" rows");


	yield query;
}




CUBE.listAlert=false;

CUBE.calc2List = function(query){
	if (!CUBE.listAlert){
//		Log.alert("Please do not use CUBE.calc2List()");
		CUBE.listAlert=true;
	}//endif

	
	if (query.edges===undefined) query.edges=[];
	var select = Array.newInstance(query.select);

	//NO EDGES IMPLIES NO AGGREGATION AND NO GROUPING:  SIMPLE SET OPERATION
	if (query.edges.length==0){
		if (select.length==0){
			yield (noOP(query));
			yield (query);
		}else if (select[0].aggregate===undefined || select[0].aggregate=="none"){
			yield (setOP(query));
			yield (query);
		}else{
			yield (aggOP(query));
			yield (query);
		}//endif
	}//endif

	if (query.edges.length == 0)
		Log.error("Tree processing requires an edge");

	yield (calc2Tree(query));

	var edges=query.edges;

	var output = [];
	Tree2List(output, query.tree, select, edges, {}, 0);
	yield (Thread.yield());

	//ORDER THE OUTPUT
	if (query.sort === undefined) query.sort = [];
	if (!(query.sort instanceof Array)) query.sort=[query.sort];
	output = CUBE.sort(output, query.sort, query.columns);

	//COLLAPSE OBJECTS TO SINGLE VALUE
	for(var ci=0;ci<query.columns.length;ci++){
		var col=query.columns[ci];
		if (col.domain===undefined){
			Log.error("expecting all columns to have a domain");
		}//endif
		var d = col.domain;
		if (d.end === undefined) continue;

		//d.end() MAY REDEFINE ITSELF (COMPILE GIVEN CONTEXT)
		for(var i = 0; i < output.length; i++){
			var o = output[i];
			o[col.name] = d.end(o[col.name]);
		}//for
	}//for

	query.list = output;

	CUBE.analytic.run(query);

	Map.copy(CUBE.query.prototype, query);

	yield (query);
};//method



function calc2Cube(query){
	if (query.edges===undefined) query.edges=[];

	if (query.edges.length==0){
		var o=yield (aggOP(query));
		yield (o);
	}//endif

	yield (calc2Tree(query));

	//ASSIGN dataIndex TO ALL PARTITIONS
	var edges = query.edges;
	for(var f = 0; f < edges.length; f++){
		var p = 0;
		for(; p < (edges[f].domain.partitions).length; p++){
			edges[f].domain.partitions[p].dataIndex = p;
		}//for
		edges[f].domain.NULL.dataIndex = p;
	}//for

	//MAKE THE EMPTY DATA GRID
	query.cube = CUBE.cube.newInstance(edges, 0, query.select);

	Tree2Cube(query, query.cube, query.tree, 0);

	CUBE.analytic.run(query);


	Map.copy(CUBE.query.prototype, query);

	yield (query);
};//method



//CONVERT LIST TO CUBE
CUBE.List2Cube=function(query){

	if (query.list!==undefined) Log.error("Can only convert list to a cube at this time");

	//ASSIGN dataIndex TO ALL PARTITIONS
	var edges = query.edges;
	for(var f = 0; f < edges.length; f++){
		var p = 0;
		for(; p < (edges[f].domain.partitions).length; p++){
			edges[f].domain.partitions[p].dataIndex = p;
		}//for
		edges[f].domain.NULL.dataIndex = p;
	}//for

	//MAKE THE EMPTY DATA GRID
	query.cube = CUBE.cube.newInstance(edges, 0, query.select);


	for(var i=query.list.length;i--;){
		var cube=query.cube;
		var e=0;
		for(;e<query.edges.length-1;e++){
			cube=cube[edges[e].dataIndex];
		}//for
		if (query.select instanceof Array){
			cube[edges[e].dataIndex]=query.list[i];
		}else{
			cube[edges[e].dataIndex]=query.list[i][query.select.name];
		}//endif
	}//for

	return query;
};//method


////////////////////////////////////////////////////////////////////////////////
//  REDUCE ALL DATA TO ZERO DIMENSIONS
////////////////////////////////////////////////////////////////////////////////
function aggOP(query){
	var select = Array.newInstance(query.select);

	var sourceColumns = yield(CUBE.getColumnsFromQuery(query));
	var from=query.from.list;
	var columns = CUBE.compile(query, sourceColumns);
	var where = CUBE.where.compile(query.where, sourceColumns, []);

	var result={};
	//ADD SELECT DEFAULTS
	for(var s = 0; s < select.length; s++){
		result[select[s].name] = select[s].defaultValue();
	}//for

	for(var i = 0; i < from.length; i++){
		var row = from[i];
		if (where(row, null)){
			for(var s = 0; s < select.length; s++){
				var ss = select[s];
				var v = ss.calc(row, result);
				result[ss.name] = ss.add(result[ss.name], v);
			}//for
		}//endif
	}//for

	//TURN AGGREGATE OBJECTS TO SINGLE NUMBER
	for(var c=0;c<columns.length;c++){
		var s=columns[c];
		if (s.domain===undefined){
			Log.error("expectin all columns to have a domain");
		}//endif
		var r = columns[c].domain.end;
		if (r === undefined) continue;

		result[s.name] = r(result[s.name]);
	}//for

	query.list = [result];
	query.cube = result;
	yield (query);
}



////////////////////////////////////////////////////////////////////////////////
//  DO NOTHING TO TRANSFORM LIST OF OBJECTS
////////////////////////////////////////////////////////////////////////////////
function noOP(query){
	var sourceColumns = yield(CUBE.getColumnsFromQuery(query));
	var from = query.from.list;


	var output;
	if (query.where===undefined){
		output=from;
	}else{
		output = [];
		var where = CUBE.where.compile(query.where, sourceColumns, []);

		var output = [];
		for(let t = from.length;t--;){
			if (where(from[t], null)){
				output.push(from[t]);
			}//endif
		}//for
	}//endif
	query.list = output;

	query.columns=sourceColumns.copy();
	CUBE.analytic.run(query);

	//ORDER THE OUTPUT
	if (query.sort === undefined) query.sort = [];

	query.list = CUBE.sort(query.list, query.sort, query.columns);

	yield (query);

}//method




////////////////////////////////////////////////////////////////////////////////
//  SIMPLE TRANSFORMATION ON A LIST OF OBJECTS
////////////////////////////////////////////////////////////////////////////////
function setOP(query){
	var sourceColumns = yield (CUBE.getColumnsFromQuery(query));
	var from=query.from.list;

	var select = Array.newInstance(query.select);
	var columns = select;



	for(let s = 0; s < select.length; s++){
		if (typeof(s)=='string') select[s]={"value":s};
		CUBE.column.compile(select[s], sourceColumns, undefined);
	}//for
	var where = CUBE.where.compile(query.where, sourceColumns, []);

	var output = [];
	for(let t = 0; t < from.length; t++){
		var result = {};
		for(var s = 0; s < select.length; s++){
			var ss = select[s];
			result[ss.name] = ss.calc(from[t], null);
		}//for
		if (where(from[t], result)){
			output.push(result);
		}//endif
	}//for


	//ORDER THE OUTPUT
	if (query.sort === undefined) query.sort = [];
	output = CUBE.sort(output, query.sort, columns);

	query.columns=columns;

	if (query.select instanceof Array || query.analytic){
		query.list = output;
		CUBE.analytic.run(query);
	}else{
		//REDUCE TO ARRAY
		query.list=output.map(function(v, i){return v[select[0].name];});
	}//endif



	yield (query);

}//method


////////////////////////////////////////////////////////////////////////////////
// TABLES ARE LIKE LISTS, ONLY ATTRIBUTES ARE INDEXED BY COLUMN NUMBER
////////////////////////////////////////////////////////////////////////////////
CUBE.toTable=function(query){

	if (query.cube===undefined) Log.error("Can only turn a cube into a table at this time");
	if (query.edges.length!=2) Log.error("can only handle 2D cubes right now.");

	var columns=[];
	var parts=[];
	var f="<CODE>";
	var param=[];
	var coord="";
	for(var w=0;w<query.edges.length;w++){
		f=f.replace("<CODE>","for(var p"+w+"=0;p"+w+"<parts["+w+"].length;p"+w+"++){\n<CODE>}\n");
		param.push("parts["+w+"][p"+w+"]");
		coord+="[p"+w+"]";

		columns[w]=query.edges[w];
		var d=query.edges[w].domain;
		if (d.end===undefined) d.end=function(part){return part;};
		parts[w]=[];
		d.partitions.forall(function(v,i){parts[w][i]=d.end(v);});
		if (query.edges[w].allowNulls) parts[w].push(d.end(d.NULL));
	}//for

	Array.newInstance(query.select).forall(function(s, i){
		columns.push(s);
		param.push("query.cube"+coord+((query.select instanceof Array) ? "["+i+"]" : ""));
	});

	var output=[];
	f=f.replace("<CODE>", "var row=["+param.join(", ")+"];\noutput.push(row);\n");
	eval(f);

	return {"columns":columns, "rows":output};

};//method


CUBE.Cube2List=function(query, options){
	//WILL end() ALL PARTS UNLESS options.useStruct==true OR options.useLabels==true

	options=nvl(options, {});
	options.useStruct=nvl(options.useStruct, false);
	options.useLabels=nvl(options.useLabels, false);

	var endFunction="query.edges[<NUM>].domain.end";
	if (options.useStruct){
		endFunction="function(v){return v;}";
	}else if (options.useLabels){
		endFunction="query.edges[<NUM>].domain.label";
	}//endif

	var name=Array.newInstance(query.select)[0].name;
	if (query.select instanceof Array) name=undefined;
	if (query.cube===undefined) Log.error("Can only turn a cube into a table at this time");
	if (query.cube.length==0) yield ([]);
	var sample=query.cube; for(var i=0;i<query.edges.length;i++) sample=sample[0];
	var isArray=(sample instanceof Array);



	var prep=
		"var parts<NUM>=query.edges[<NUM>].domain.partitions.copy();\n"+
		"if (query.edges[<NUM>].allowNulls) parts<NUM>.push(query.edges[<NUM>].domain.NULL);\n"+
		"var end<NUM>="+endFunction+";\n"+
		"var name<NUM>=query.edges[<NUM>].name;\n"+
		"var partValue<NUM>=[];\n"+
		"for(var p<NUM>=0; p<NUM><parts<NUM>.length; p<NUM>++) partValue<NUM>.push("+
			"end<NUM>("+
			"parts<NUM>[p<NUM>]"+
			")"+
		");\n"+
		""
	;

	var loop=
		"for(var p<NUM>=0; p<NUM><parts<NUM>.length;p<NUM>++){\n"+
			"<BODY>"+
		"}\n";

	var assignEdge="row[<EDGE_NAME>]=partValue<NUM>[p<NUM>];\n";

	var accessCube="query.cube";
	var loops="<BODY>";
	var pre="";
	var assignEdges="";
	for(var i=0;i<query.edges.length;i++){
		pre+=prep.replaceAll("<NUM>", ""+i);
		loops=loops.replace("<BODY>", loop.replaceAll("<NUM>", ""+i));
		assignEdges+=assignEdge.replaceAll("<NUM>", ""+i).replaceAll("<EDGE_NAME>", CNV.String2Quote(query.edges[i].name));
		accessCube+="[p"+i+"]";
	}//for


	var assignSelect;
	if (name){
		assignSelect="var row={};\nrow["+CNV.String2Quote(name)+"]="+accessCube+";\n";
	}else if (isArray){
		assignSelect=
			"var row={};\n"+
			"for(var s=0;s<query.select.length;s++){\n"+
			"	row[query.select[s].name]="+accessCube+"[s];\n"+
			"}\n";
	}else{
		assignSelect="var row=Map.copy("+accessCube+");\n";
	}//endif

	var code=
		"cube2list=function(query){\n"+
			"var output=[];\n"+
			pre+
			loops.replace("<BODY>",
				assignSelect+
				assignEdges+
				"output.push(row);\n"
			)+
			"return output;"+
		"};"
	;

	//COMPILE
	var cube2list;
	eval(code);
	

	{//EVAL
		var t=new aTimer("Convert from cube to list", Duration.SECOND);
		yield (cube2list(query));
		t.end();
	}

};//method



////////////////////////////////////////////////////////////////////////////////
// ASSUME THE FIRST DIMESION IS THE COHORT, AND NORMALIZE (DIVIDE BY SUM(ABS(Xi))
////////////////////////////////////////////////////////////////////////////////
CUBE.normalizeByCohort=function(query, multiple){
	if (multiple===undefined) multiple=1.0;
	if (query.cube===undefined) Log.error("Can only normalize a cube into a table at this time");

//	SELECT
//		count/sum(count over Cohort) AS nCount
//	FROM
//		query.cube

	for(var c=0;c<query.cube.length;c++){
		var total=0;
		for(var e=0;e<query.cube[c].length;e++) total+=aMath.abs(query.cube[c][e]);
		if (total!=0){
			for(var e=0;e<query.cube[c].length;e++) query.cube[c][e]*=(multiple/total);
		}//endif
	}//for
};//method

////////////////////////////////////////////////////////////////////////////////
// ASSUME THE SECOND DIMESION IS THE XAXIS, AND NORMALIZE (DIVIDE BY SUM(ABS(Ci))
////////////////////////////////////////////////////////////////////////////////
CUBE.normalizeByX=function(query, multiple){
	if (multiple===undefined) multiple=1;
	if (query.cube===undefined) Log.error("Can only normalize a cube into a table at this time");

//	SELECT
//		count/sum(count over Cohort) AS nCount
//	FROM
//		query.cube

	for(var e=0;e<query.cube[0].length;e++){
		var total=0;
		for(var c=0;c<query.cube.length;c++){
			if (query.cube[c][e]===undefined) query.cube[c][e]=0;
			total+=aMath.abs(query.cube[c][e]);
		}//for
		if (total!=0){
			for(var c=0;c<query.cube.length;c++) query.cube[c][e]*=(multiple/total);
		}//endif
	}//for
};//method


CUBE.removeZeroParts=function(query, edgeIndex){
	if (query.cube===undefined) Log.error("Can only normalize a cube into a table at this time");

	var zeros=query.edges[edgeIndex].domain.partitions.map(function(){ return true;});

	if (query.edges.length!=2){
		Log.error("not implemented yet");

	}else{
		if (edgeIndex==0){
			for(var c=0;c<query.cube.length;c++){
				for(var e=0;e<query.cube[c].length;e++){
					var v=query.cube[c][e];
					if (v!==undefined && v!=null && query.cube[c][e]!=0) zeros[c]=false;
				}//for
			}//for

			query.edges[0].domain.partitions=query.edges[0].domain.partitions.map(function(part, i){
				if (zeros[i]) return undefined;
				var output=Map.copy(part);
				output.dataIndex=i;
				return output;
			});
			query.edges[0].domain.NULL.index=query.edges[0].domain.partitions.length;
			query.cube=query.cube.map(function(v, i){
				if (zeros[i]) return undefined;
				return v;
			});
		}else if (edgeIndex==1){
			for(var c=0;c<query.cube.length;c++){
				for(var e=0;e<query.cube[c].length;e++){
					var v=query.cube[c][e];
					if (v!==undefined && v!=null && query.cube[c][e]!=0) zeros[e]=false;
				}//for
			}//for
			query.edges[1].domain.partitions=query.edges[1].domain.partitions.map(function(part, i){
				if (zeros[i]) return undefined;
				var output=Map.copy(part);
				output.dataIndex=i;
				return output;
			});
			query.edges[1].domain.NULL.index=query.edges[1].domain.partitions.length;
			query.cube=query.cube.map(function(r, i){
				return r.map(function(c, j){
					if (zeros[j]) return undefined;
					return c;
				})
			});




		}//endif

	}//endif
};


// CONVERT THE tree STRUCTURE TO A FLAT LIST FOR output
function Tree2List(output, tree, select, edges, coordinates, depth){
	if (depth == edges.length){
		//FRESH OBJECT
		var obj={};
		Map.copy(coordinates, obj);
		for(var s=0;s<select.length;s++){
			obj[select[s].name]=tree[s];
		}//for
		output.push(obj);
	} else{
		var keys = Object.keys(tree);
		for(var k = 0; k < keys.length; k++){
			coordinates[edges[depth].name]=edges[depth].domain.getPartByKey(keys[k]);
			Tree2List(output, tree[keys[k]], select, edges, coordinates, depth + 1)
		}//for
	}//endif
//	yield (null);
}//method




// CONVERT THE tree STRUCTURE TO A cube
function Tree2Cube(query, cube, tree, depth){
	var edge=query.edges[depth];
	var domain=edge.domain;

	if (depth < query.edges.length-1){
		let keys=Object.keys(tree);
		for(var k=keys.length;k--;){
			var p=domain.getPartByKey(keys[k]).dataIndex;
			if (cube[p]===undefined){
				Log.debug();
				p=domain.getPartByKey(keys[k]).dataIndex;
			}//endif
			Tree2Cube(query, cube[p], tree[keys[k]], depth+1);
		}//for
		return;
	}//endif

	if (query.select instanceof Array){
		let keys=Object.keys(tree);
		for(var k=keys.length;k--;){
			var p=domain.getPartByKey(keys[k]).dataIndex;
			//I AM CONFUSED: ARE CUBE ELEMENTS ARRAYS OR OBJECTS?
//			var tuple=[];
//			for(var s = 0; s < query.select.length; s++){
//				tuple[s] = tree[keys[k]][s];
//			}//for
			var tuple={};
			for(var s = 0; s < query.select.length; s++){
				tuple[query.select[s].name] = query.select[s].domain.end(tree[keys[k]][s]);
			}//for
			cube[p]=tuple;
		}//for
	} else{
		let keys=Object.keys(tree);
		for(var k=keys.length;k--;){
			var p=domain.getPartByKey(keys[k]).dataIndex;
			cube[p]=query.select.domain.end(tree[keys[k]][0]);
		}//for
	}//endif

}//method




////ADD THE MISSING DOMAIN VALUES
//CUBE.nullToList=function(output, edges, depth){
//	if ()
//
//
//};//method

//RETURN THE COLUMNS FROM THE GIVEN QUERY
//ALSO NORMALIZE THE ARRAY OF OBJECTS TO BE AT query.from.list
CUBE.getColumnsFromQuery=function(query){
	//FROM CLAUSE MAY BE A SUB QUERY

	var sourceColumns;
	if (query.from instanceof Array){
		sourceColumns = CUBE.getColumnsFromList(query.from);
		query.from.list = query.from;	//NORMALIZE SO query.from.list ALWAYS POINTS TO AN OBJECT
	} else if (query.from.list){
		sourceColumns = query.from.columns;
	} else if (query.from.cube){
		query.from.list = yield (CUBE.Cube2List(query.from));
		sourceColumns = query.from.columns;
	}else if (query.from.from!=undefined){
		query.from=yield (CUBE.calc2List(query.from));
		sourceColumns=yield (CUBE.getColumnsFromQuery(query));
	}else{
		Log.error("Do not know how to handle this");
	}//endif
	yield (sourceColumns);
};//method


// PULL COLUMN DEFINITIONS FROM LIST OF OBJECTS
CUBE.getColumnsFromList = function(data){
	if (data.length==0 || typeof(data[0])=="string")
		return [];

	var output = [];
	for(var i = 0; i < data.length; i++){
		var keys = Object.keys(data[i]);
		kk: for(var k = 0; k < keys.length; k++){
			for(var c = 0; c < output.length; c++){
				if (output[c].name == keys[k]) continue kk;
			}//for
			var column={"name":keys[k], "domain":CUBE.domain.value};
			output.push(column);
		}//for
	}//for
	return output;
};//method




//
// EXPECTING AN ARRAY OF CUBES, AND THE NAME OF THE EDGES TO MERGE
// THERE IS NO LOGICAL DIFFERENCE BETWEEN A SET OF CUBES, WITH IDENTICAL EDGES, EACH CELL A VALUE AND
// A SINGLE CUBE WITH EACH CELL BEING AN OBJECT: EACH ATTRIBUTE VALUE CORRESPONDING TO A CUBE IN THE SET
//	var chart=CUBE.merge([
//		{"from":requested, "edges":["time"]},
//		{"from":reviewed, "edges":["time"]},
//		{"from":open, "edges":["time"]}
//	]);
CUBE.merge=function(query){
	//MAP THE EDGE NAMES TO ACTUAL EDGES IN THE from QUERY
	query.cubes.forall(function(item){
		if (item.edges.length!=item.from.edges.length) Log.error("do not know how to join just some of the edges");

		item.edges.forall(function(pe, i, edges){
			item.from.edges.forall(function(pfe, j){
				if (pfe.name==pe)
					edges[i]=pfe;
			});//for
			if (typeof(edges[i])=="string")
				Log.error(edges[i]+" can not be found");
		});
	});

	var commonEdges=query.cubes[0].edges;

	var output={};
	output.name=query.name;
	output.from=query;
	output.edges=[];
	output.edges.appendArray(commonEdges);
	output.select=[];
	output.columns=[];
	output.columns.appendArray(commonEdges);

	output.cube=CUBE.cube.newInstance(output.edges, 0, []);
	Map.copy(CUBE.query.prototype, output);

	query.cubes.forall(function(item, index){
		//COPY SELECT DEFINITIONS
		output.select.appendArray(Array.newInstance(item.from.select));
		output.columns.appendArray(Array.newInstance(item.from.select));


		//VERIFY DOMAINS ARE IDENTICAL, AND IN SAME ORDER
		if (item.edges.length!=commonEdges.length) Log.error("Expecting all partitions to have same number of (common) edges declared");
		item.edges.forall(function(edge, i){
			if (typeof(edge)=="string") Log.error("can not find edge named '"+edge+"'");
			if (!CUBE.domain.equals(commonEdges[i].domain, edge.domain)) Log.error("Edges domains ("+item.from.name+", edge="+edge.name+") and ("+query.cubes[0].from.name+", edge="+commonEdges[i].name+") are different");
		});


		//CONVERT TO CUBE FOR COPYING
		if (item.from.cube!==undefined){
			//DO NOTHING
		}else if (item.from.list!==undefined){
			item.cube=CUBE.List2Cube(item.from).cube;
		}else{
			Log.error("do not know how to handle");
		}//endif


		//COPY ATTRIBUTES TO NEW JOINED
		if (output.edges.length==1){

			let parts=output.edges[0].domain.partitions;
			let num=parts.length;
			if (output.edges[0].allowNulls){
				if (parts[parts.length-1]!=output.edges[0].domain.NULL) Log.error("Expecting NULL in the partitions");
			}else{
				if (parts[parts.length-1]==output.edges[0].domain.NULL){
					Log.error("When !allowNulls, then there should be no NULL in the partitions");
					num--;
				}//endif
			}//endif

			if (item.from.select instanceof Array){
				for(let i=num;i--;){
					if (item.edges[0].domain.partitions[i].dataIndex!=i)
						Log.error("do not know how to handle");
					var row=output.cube[i];
					Map.copy(item.from.cube[i], row);
				}//for
			}else{
				//CUBE HAS VALUES, NOT OBJECTS
				for(let i=num;i--;){
					if (item.edges[0].domain.partitions[i].dataIndex!=i)
						Log.error("do not know how to handle");
					output.cube[i][item.from.select.name]=item.from.cube[i];
				}//for
			}//endif


		}else if (output.edges.length==2){

			var parts0=output.edges[0].domain.partitions;
			var num0=parts0.length;
			var parts1=output.edges[1].domain.partitions;
			var num1=parts1.length;

			if (output.edges[0].allowNulls){
				if (parts0[parts0.length-1]!=output.edges[0].domain.NULL) Log.error("Expecting NULL in the partitions");
			}else{
				if (parts0[parts0.length-1]==output.edges[0].domain.NULL){
					Log.error("When !allowNulls, then there should be no NULL in the partitions");
					num0--;
				}//endif
			}//endif

			if (output.edges[1].allowNulls){
				if (parts1[parts1.length-1]!=output.edges[1].domain.NULL) Log.error("Expecting NULL in the partitions");
			}else{
				if (parts1[parts1.length-1]==output.edges[1].domain.NULL){
					Log.error("When !allowNulls, then there should be no NULL in the partitions");
					num1--;
				}//endif
			}//endif



			if (item.from.select instanceof Array){
				for(let i=num0;i--;){
					for(let j=num1;j--;){
						Map.copy(item.from.cube[i][j], output.cube[i][j]);
					}//for
				}//for
			}else{
				//CUBE HAS VALUES, NOT OBJECTS
				for(let i=num0;i--;){
					for(let j=num1;j--;){
						output.cube[i][j][item.from.select.name]=item.from.cube[i][j];
					}//for
				}//for
			}//endif

		}else{
			Log.error("Can not copy more than two dimensional cube");
		}//endif

	});

//	output.select=query.partitions[0].from.select;	//I AM TIRED, JUST MAKE A BUNCH OF ASSUMPTIONS

	return output;
};//method





////////////////////////////////////////////////////////////////////////////////
// ORDERING
////////////////////////////////////////////////////////////////////////////////
//TAKE data LIST OF OBJECTS AND ENSURE names ARE ORDERED
CUBE.sort = function(data, sortOrder, columns){
	if (sortOrder.length==0) return data;
	var totalSort = CUBE.sort.compile(sortOrder, columns, true);
	data.sort(totalSort);
	return data;
};//method


CUBE.sort.compile=function(sortOrder, columns, useNames){
	var orderedColumns = sortOrder.map(function(v){
		for(var i=columns.length;i--;){
			if (columns[i].name==v && !(columns[i].sortOrder==0)) return columns[i];
		}//for
		Log.error("Sorting can not find column named '"+v+"'");
	});

	var f="totalSort = function(a, b){\nvar diff;\n";
	for(var o = 0; o < orderedColumns.length; o++){
		var col = orderedColumns[o];
		if (orderedColumns[o].domain === undefined){
			Log.warning("what?");
		}//endif

		var index=useNames ? CNV.String2Quote(col.name) : col.columnIndex;
		f+="diff = orderedColumns["+o+"].domain.compare(a["+index+"], b["+index+"]);\n";
		if (o==orderedColumns.length-1){
			if (col.sortOrder===undefined || col.sortOrder==1){
				f+="return diff;\n";
			}else{
				f+="return "+col.sortOrder+" * diff;\n";
			}//endif
		}else{
			if (col.sortOrder===undefined || col.sortOrder==1){
				f+="if (diff != 0) return diff;\n";
			}else{
				f+="if (diff != 0) return "+col.sortOrder+" * diff;\n";
			}//endif
		}//endif
	}//for
	f+="\n}";

	var totalSort;
	eval(f);
	return totalSort;
};//method



//RETURN A NEW QUERY WITH ADDITIONAL FILTERS LIMITING VALUES
//TO series AND category SELECTION *AND* TRANSFORMING TO AN SET OPERATION
CUBE.specificBugs=function(query, filterParts){

	var newQuery=CUBE.drill(query, filterParts);
	newQuery.edges=[];

	newQuery.select={"name":"bug_id", "value":"bug_id"};
	return newQuery;
};


//parts IS AN ARRAY OF PART NAMES CORRESPONDING TO EACH QUERY EDGE
CUBE.drill=function(query, parts){
	if (query.analytic) Log.error("Do not know how to drill down on an analytic");

	var newQuery={};
	Map.copy(query, newQuery);
	newQuery.cube=undefined;
	newQuery.list=undefined;
	newQuery.url=undefined;			//REMOVE, MAY CAUSE PROBLEMS
	if (query.esfilter){
		if (query.esfilter.and){
			newQuery.esfilter={"and":query.esfilter.and.copy()};
		}else{
			newQuery.esfilter={"and":[query.esfilter]};
		}//endif
	}else{
		newQuery.esfilter={"and":[]};
	}//endif

	if (parts.length==2 && query.edges.length==1){

	}

	query.edges.forall(function(edge, e){
		if (parts[e]==undefined) return;

		for(let p=0;p<edge.domain.partitions.length;p++){
			var part=edge.domain.partitions[p];
			if (
				(edge.domain.type=="time" && part.value.getMilli()==parts[e].getMilli()) ||  //CCC VERSION 2 (TIME ONLY)
				(part.name==parts[e])  //CCC VERSION 1
			){
				let filter=ESQuery.buildCondition(edge, part, query);
				newQuery.esfilter.and.push(filter);
				return;  //CONTINUE
			}//endif
		}//for
		if (edge.domain.NULL.name==parts[e]){
			let filter={"script":{"script":MVEL.compile.expression(ESQuery.compileNullTest(edge), newQuery)}};
			newQuery.esfilter.and.push(filter);
			return;  //CONTINUE
		}//endif
		Log.error("No drilling happening!");
	});

	return newQuery;

};

	//SELECT ARE JUST ANOTHER DIMENSION (ALTHOUGH DIMENSION OF MANY TYPES)
	//HERE WE CONVERT IT EXPLICITLY
	CUBE.stack=function(query, newEdgeName, newSelectName){
		//ADD ANOTHER DIMENSION TO EDGE, AND ALTER CUBE
		if (!query.select instanceof Array) Log.error("single cube with no objects does not need to be stacked");

		//GET select NAMES
		var parts=Array.newInstance(query.select);
		var output={"edges":query.edges.copy()};
		output.select={"name":newSelectName};
		output.edges.append({
			"name":newEdgeName,
			"domain":{"type":"set", "partitions":parts, "key":"name", "end":function(p){return p.name;}}
		});
		output.columns=output.edges.copy();
		output.columns.append(output.select);

		function stackSelect(arr){
			if (arr instanceof Array){
				return arr.map(stackSelect);
			}//endif

			//CONVERT OBJECT INTO ARRAY
			var a=[];
			for(var p=parts.length;p--;){
				var part=parts[p];
				a[p]=arr[part.name];
			}//for
			return a;
		}//method

		output.cube=stackSelect(query.cube);
		return output;
	};



	CUBE.query={};
	CUBE.query.prototype={};
	//GET THE SUB-CUBE THE HAD name=value
	CUBE.query.prototype.get=function(name, value){
		if (this.edges.length>1)
			//THIS ONLY INDEXES INTO A SINGLE DIMENSION
			Log.error("can not handle more than one dimension at this time");
		var edge=this.getEdge(name);
		return this.cube[edge.domain.getPartByKey(value).dataIndex];
	};

	CUBE.query.prototype.indexOf=function(name, value){
		var edge=this.getEdge(name);
		return edge.domain.getPartByKey(value).dataIndex;
	};

	CUBE.query.prototype.getEdge=function(name){
		return this.edges.map(function(e, i){ if (e.name==name) return e;})[0];
	};

	Q=calc2Cube;


})();

