/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


Stats={};

Stats.df={};

//GIVEN A STEPWISE df, RETURN THE STEP WHICH APPROXIMATES THE percentile
Stats.df.percentile=function(df, percentile){
	var df=Stats.df.normalize(df);

	var total=0;
	for(var i=0;i<df.length;i++){
		total+=df[i];
		if (total>=percentile){
			var part=(percentile-total)/df[i];
			return part+i+1;
		}//endif
	}//for
	return df.length;		//HAPPENS WHEN df[i]==0
};//method

//NORMALIZE TO A DISTRIBUTION FUNCTION
Stats.df.normalize=function(df){
	var total=0;
	for(var t=df.length;t--;) total+=aMath.abs(df[t]);
	if (total==0 || (1-epsilon)<total && total<(1+epsilon)) return df;

	var output=[];
	for(var i=df.length;i--;) output[i]=df[i]/total;
	return output;
};//method

epsilon=1/1000000;


//EXPECTING AGE DATA {"id", "birth", "death"}
//EXPECTING REPORTING INTERVAL timeEdge={"min", "max", "interval"}
//EXPECTING SAMPLE DURATION (ASSUMED PRECEEDING) {"duration"}
//IT IS ASSUMED THE data INCLUDES RANGE {"min":min-duration, "max"} FOR ACCURACY
//DATA NEED NOT BE ORDERED
//RETURNS {"time", "age"} FOR PERCENTILE REQUESTED
Stats.percentileAgeOverTime=function(data, timeEdge, sampleSize, percentile){
	var newdata=data.map(function(v, i){
		var d=[];
		d[0]=v.birth.getMilli();
		d[1]=v.death.getMilli();
	});

	var output=[];
	for(var i=timeEdge.min;i.getMilli()<timeEdge.max.getMilli();i=i.add(timeEdge.interval)){
		var min=i.subtract(sampleSize).getMilli();
		var max=i.getMilli();

		var ages=[];
		for(var d=0;d<newdata.length;d++){
			if (newdata[d][0]>=min) ages.push(aMath.min(max, newdata[d][1])-newdata[d][0]);
		}//for

		ages.sort();
		var smaller=aMath.floor(ages.length*percentile);
		var larger=aMath.max(smaller+1, ages.length-1);
		var r=(ages.length*percentile) - smaller;
		var value=ages[smaller]*(1-r)+(ages[larger]*r);

		output.push({"time":i, "age":value});
	}//for

	return output;
};


//EXPECTING AGE DATA {"id", "birth", "death"}
//EXPECTING REPORTING INTERVAL timeEdge={"min", "max", "interval"}
//EXPECTING SAMPLE DURATION (ASSUMED PRECEEDING) {"duration"}
//IT IS ASSUMED THE data INCLUDES RANGE {"min":min-duration, "max"} FOR ACCURACY
//DATA NEED NOT BE ORDERED
//RETURNS {"time", "age"} FOR PERCENTILE REQUESTED
Stats.ageOverTime=function(data, timeEdge, sampleSize, statFunction){
	var newdata=data.map(function(v, i){
		var d=[];
		d[0]=v.birth;
		d[1]=v.death;
		return d;
	});
	newdata.sort(function(a, b){return a[0]-b[0]});


	var start=0;  //SINCE i IS STRICTLY INCREASING, NO NEED TO REVISIT d<start 
	var output=[];
	for(var i=timeEdge.min;i.getMilli()<timeEdge.max.getMilli();i=i.add(timeEdge.interval)){
		var min=i.subtract(sampleSize).getMilli();
		var max=i.getMilli();

		var ages=[];
		for(var d=start;d<newdata.length;d++){
			if (min>newdata[d][0]){
				start=d;
				continue;
			}//endif
			if (newdata[d][0]>=max) break;

			var age=aMath.min(max, newdata[d][1]) - newdata[d][0];
			ages.push(age);
		}//for

		//VALUE MUST BE AN OBJECT (WITH MANY STATS)
		var value=statFunction(ages);
		value.time=i;
		output.push(value);
	}//for

	return output;
};

//selectColumns IS AN ARRAY OF SELECT COLUMNS {"name", "percentile"}
//values IS AN ARRAY OF RAW NUMBERS
Stats.percentiles=function(values, selectColumns){
	values.sort(function(a, b){return a-b;});
	var output={};
	for(var i=0;i<selectColumns.length;i++){
		var smaller=aMath.floor(values.length*selectColumns[i].percentile);
		var larger=aMath.min(smaller+1, values.length-1);
		var r=(values.length*selectColumns[i].percentile) - smaller;
		output[selectColumns[i].name]=values[smaller]*(1-r)+(values[larger]*r);

	}//for
	return output;
};



//selectColumns IS AN ARRAY OF SELECT COLUMNS {"name", "percentile"}
//values IS AN ARRAY OF RAW NUMBERS
//LINEAR INTERPOLATION IS USED
Stats.percentile=function(values, percentile){
	if (values.length==0) return null;

	values.sort(function(a, b){return a-b;});
	var smaller=aMath.floor(values.length*percentile);
	var larger=aMath.min(smaller+1, values.length);
	values.prepend(0);
	var r=(values.length*percentile) - smaller;
	return values[smaller]*(1-r)+(values[larger]*r);
};


//USING ONE
//Stats.percentile=function(values, percentile){
//	if (values.length==0) return null;
//
//	values.sort(function(a, b){return a-b;});
//	var smaller=aMath.floor(values.length*percentile+0.5);
//	if (smaller==0) return 0;
//	return values[smaller-1];
//};




Stats.query2regression=function(query){
	var select=CUBE.select2Array(query.select);
	if (query.edges.length==2 && select.length==1){
		//WE ASSUME THE SELECT IS THE WEIGHT FUNCTION
	}else{
		D.error("Not supported");
	}//endif

	//CONVERT LINEAR DOMAINS TO doubles
	var domainY=CUBE.domain.domain2linear(query.edges[0].domain);
	var domainX=CUBE.domain.domain2linear(query.edges[1].domain);

	//SEND TO REGRESSION CALC
	var line=Stats.regression(query.cube, domainX, domainY);

	//CONVERT BACK TO DOMAIN (result REFERS TO
	if (["time", "duration"].contains(domainX.type)) D.error("Can not convert back to original domain, not implemented yet");
	if (["time", "duration"].contains(domainY.type)) D.error("Can not convert back to original domain, not implemented yet");


	//BUILD NEW QUERY WITH NEW CUBE
	var output=Map.copy(query);
	output.select={"name":query.edges[0].name};
	output.edges=[query.edges[1]];

	output.cube=[];
	domainX.partitions.forall(function(v, i){
		var part=domainX.partitions[i];
		output.cube[i]=line((part.min+part.max)/2)
	});
	output.name=" ";

	return output;
};

//ASSUMES A CUBE OF WEIGHT VALUES
//RETURN THE REGRESSION LINE FOR THE GIVEN CUBE
Stats.regression=function(weights, domainX, domainY){

	var t={};
	t.N=0;
	t.X1=0;
	t.X2=0;
	t.XY=0;
	t.Y1=0;
	t.Y2=0;

	var x=domainX.min+(domainX.interval/2);
	for(var i=0;x<domainX.max;x+=domainX.interval){
		var y=domainY.min+(domainY.interval/2);
		for(var j=0;y<domainY.max;y+=domainY.interval){
			var w=weights[i][j];
			t.N+=w;
			t.X1+=w*x;
			t.X2+=w*x*x;
			t.XY+=w*x*y;
			t.Y2+=w*y*y;
			t.Y1+=w*y;
			j++;
		}//for
		i++;
	}//for

	return Stats.regressionLine(t);
};

//EXPECT THE RAW TERMS FROM THE SERIES
Stats.regressionLine=function(terms){
	var o=terms;
	o.SSx=o.X2 - o.X1*o.X1/o.N;
	o.SSy=o.Y2 - o.Y1*o.Y1/o.N;
	o.Sxy=o.XY - o.X1*o.Y1/o.N;
	o.slope=o.Sxy/o.SSx;
	o.offset=(o.Y1-o.slope*o.X1)/o.N;
	o.r2=(o.Sxy*o.Sxy)/(o.SSx*o.SSy);


	var output=function(x){
		return o.slope*x+o.offset;
	};
	Map.copy(o, output);

	return output;
};

