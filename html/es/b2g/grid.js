/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var NOW = Date.today();
var TOO_LATE = NOW.subtract(Duration.newInstance("2day"));
var REALLY_TOO_LATE = NOW.subtract(Duration.newInstance("1week"));

var WARNING_STYLE = {
	"cursor": "pointer",
	"color": "white",
	"font-weight": "bold",
	"background-color": "#ff7f0e"
};
var ERROR_STYLE = {
	"cursor": "pointer",
	"color": "white",
	"font-weight": "bold",
	"background-color": "#d62728"
};
var UNASSIGNED_STYLE = {
	"cursor": "pointer",
	"color": "white",
	"font-weight": "bold",
	"background-color": "#9467bd"
};

function isVisible(projectName, stateName) {
	if (projectName == "Other" && ["Open - Unassigned", "Open - Assigned", "Regression"].contains(stateName)) {
		return true;
	} else if (projectName != "Other" && ["Nominated", "Blocker", "Regression"].contains(stateName)) {
		return true;
	}//endif
	return false;
}



function addNumberClickers(cube, mainFilter) {
	var prefix = cube.name.deformat() + "_value";
	$("td").filter(function () {
		return nvl($(this).attr("id"), "").startsWith(prefix);
	}).click(function (e) {
			var id = $(this).attr("id");
			var coord = id.rightBut(prefix.length).split("x").map(function (v) {
				return CNV.String2Integer(v);
			});
			var filter = {"and": cube.edges.map(function (edge, i) {
				var part = edge.domain.partitions[coord[i]];
				if (part.esfilter) {
					return part.esfilter;
				} else {
					return {"term": Map.newInstance(edge.value, part.value)}
				}//endif
			})};
			filter["and"].append(mainFilter);

			Thread.run(function*() {
				var bugs = yield(ESQuery.run({
					"from": "bugs",
					"select": "bug_id",
					"esfilter": filter
				}));
				Bugzilla.showBugs(bugs.list);

			});
		});
}//function

function addTeamClickers(cube) {
	$("td").filter(function () {
		return nvl($(this).attr("id"), "").startsWith("_team");
	}).click(function (e) {
			var id = $(this).attr("id");
			var team = cube.edges[0].domain.partitions[CNV.String2Integer(id.rightBut("_team".length))];

			window.open("B2G-Team.html#" + CNV.Object2URL({
				"team": team.name.replaceAll(" ", "_")
			}));
		});

}//function


// FORMAT THE THREE DIMENSIONAL CUBE TO A HIERARCHICAL GRID
function cube2grid(param) {
	var cube = param.cube;
	var teamEdge = cube.getEdge(param.rows[0]);
	var projectEdge = cube.getEdge(param.columns[0]);
	var stateEdge = cube.getEdge(param.columns[1]);

	var id_prefix = cube.name.deformat() + "_value";
	var num_state = stateEdge.domain.partitions.length;

	var header = "<thead>" +
		"<tr><td rowspan='" + param.columns.length + "' style='vertical-align:middle;width:400px;'><h3>{{NAME}}</h3></td>{{PROJECT_HEADERS1}}</tr>" +
		"<tr>{{PROJECT_HEADERS2}}</tr>" +
		"</thead>";
	var teamTemplate = "<tr style='height:30px'><td id='{{ID}}' class='hoverable' style='line-height:90%;width:175px' >{{TEAM}}</td>{{PROJECT_DATA}}</tr>";
	var projectHeader1 = "<td class='vSeperatorA'></td><td colspan='" + num_state + "''>{{PROJECT}}</td>";
	var projectHeader2 = "<td class='vSeperatorA'></td>{{STATE_HEADERS}}";
	var projectData = "<td class='vSeperatorA'></td>{{STATE_DATA}}";

	var stateHeader = "<td style='height:100px;width:40px;vertical-align:bottom;'><div style='height:30px;width:30px;vertical-align:bottom;overflow: visible;-moz-transform:rotate(270deg);'>{{STATE}}</div></td>\n";
	var stateData = "<td id='{{ID}}' class='hoverable'><div style='{{STYLE}}'>{{VALUE}}</div></td>\n";

	var head = header
		.replaceAll("{{NAME}}", cube.name)
		.replaceAll("{{PROJECT_HEADERS1}}", projectEdge.domain.partitions.map(function (project) {
			return projectHeader1.replaceAll("{{PROJECT}}", project.name.replaceAll(" ", "&nbsp;"))
		}).join(""));
	head = head.replaceAll("{{PROJECT_HEADERS2}}", projectEdge.domain.partitions.map(function (project) {
		var stateHeaders = stateEdge.domain.partitions.map(function (state) {
			if (isVisible(project.name, state.name)) {
				return stateHeader.replaceAll("{{STATE}}", state.name.replaceAll(" ", "&nbsp;"));
			}//endif
		}).join("");
		return projectHeader2.replaceAll("{{STATE_HEADERS}}", stateHeaders);
	}).join(""));

	var body = cube.cube.map(function (projects, t) {
		var team = teamEdge.domain.partitions[t];

		return teamTemplate
			.replaceAll("{{TEAM}}", team.name)
			.replaceAll("{{ID}}", "_team" + t)
			.replaceAll("{{PROJECT_DATA}}", projects.map(function (states, p) {
				var project = projectEdge.domain.partitions[p];
				return projectData.replaceAll("{{STATE_DATA}}", states.map(function (value, s) {
					var state = stateEdge.domain.partitions[s];
					if (isVisible(project.name, state.name)) {
						var html;
						if (value.count == 0) {
							html = stateData
								.replaceAll("{{VALUE}}", " ")
								.replaceAll("{{STYLE}}", "");
						} else if (value.unassigned > 0) {
							html = stateData
								.replaceAll("{{VALUE}}", value.count)
								.replaceAll("{{STYLE}}", CNV.Map2Style(UNASSIGNED_STYLE));
						} else if (project.name != "1.5" && ["Regression", "Blocker", "Nominated"].contains(state.name) && value.oldest < REALLY_TOO_LATE.getMilli()) {

							html = stateData
								.replaceAll("{{VALUE}}", value.count)
								.replaceAll("{{STYLE}}", CNV.Map2Style(ERROR_STYLE));
						} else if (project.name != "1.5" && ["Regression", "Blocker", "Nominated"].contains(state.name) && value.oldest < TOO_LATE.getMilli()) {
							html = stateData
								.replaceAll("{{VALUE}}", value.count)
								.replaceAll("{{STYLE}}", CNV.Map2Style(WARNING_STYLE));
						} else {
							html = stateData
								.replaceAll("{{VALUE}}", value.count)
								.replaceAll("{{STYLE}}", "");
						}//endif
						html = html.replaceAll("{{ID}}", id_prefix + t + "x" + p + "x" + s);
						return html;
					}//endif
				}).join(""));
			}).join(""));
	}).join("");

	return "<table class='grid'>" + head + "<tbody>" + body + "</tbody></table>";
}//function

