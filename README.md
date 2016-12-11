
Mozilla Developer Metrics
=========================

Objective
---------

This project is designed to optimize the creation of dashboards using ElasticSearch data.  Many tools already exist to
make dashboards, for example: Cognos, MicroStrategy, Pentaho and Tableau.  Unlike these tools, MoDevMetrics is suited
for programmers: Code, testability, and version control are important.

Examples
--------

[My page of charts](http://people.mozilla.org/~klahnakoski/charts.html) hosts the master branch of this repo.  Please
feel free to view and run them through your debugger.


Benefits
--------

  * **No Web Server** - Dashboards are simply Javascript (AJAX) and HTML.  There is no server to setup.
  * **No Schema** - ElasticSearch stores JSON documents with little fixed schema.  This is good for rapid prototyping,
  and makes it easy to annotate data without adding the complications of data migration.
  * **Code is versionable** - Data topology and data queries are described in JSON, dashboard layout is HTML and CSS.
  This makes the code (and changes to the code) amenable to version control.
  * **Queries are JSON** - Queries are in JSON structures, which are easily transmitted or serialized, and are easily
  handled by both Javascript and Python.  The Qb query form provides an abstraction layer between the docstore/database
  holding the data and the charting/stats package performing the analysis.

Drawbacks
---------

  * **No GUI tools** - There is no drag-and-drop query builder, You must be proficient in SQL and other high level list
  comprehensions.
  * **No GUI Layout** - Layout of dashboard is done in HTML and CSS.
  * **Limited Charting** (for now) - There are better charting libraries out there.

Requirements
------------

Access to one of the bug clusters is required:

  - HTTPS proxy to public cluster<br> ```https://esfrontline.bugzilla.mozilla.org:443/public_bugs/bug_version```
  - Non-encrypted proxy to public cluster<br>```http://esfrontline-public-vip.bugs.scl3.mozilla.com:80/public_bugs/bug_version```
  - Direct to private cluster (need VPN access)<br>```http://esfrontline-private-vip.bugs.scl3.mozilla.com:9200/private_bugs/bug_version```

Due to restrictions on the public cluster, it is best to test it with the [the
minimum viable example page](html/es/Tutorial01-Minimum.html).  The clusters
behind VPN can be tested normally with [ElasticSearch Head](https://github.com/mobz/elasticsearch-head).

Install
-------

    git clone https://github.com/klahnakoski/MoDevMetrics.git

    Cloning into 'MoDevMetrics'...
    remote: Counting objects: 6563, done.
    remote: Compressing objects: 100% (3142/3142), done.
    remote: Total 6563 (delta 4485), reused 5226 (delta 3148)
    Receiving objects: 100% (6563/6563), 17.89 MiB | 234 KiB/s, done.
    Resolving deltas: 100% (4485/4485), done.
    Checking out files: 100% (437/437), done.

Examples
--------

Code examples to demonstrate minimum functionality:

  * [Test public connectivity](html/es/Tutorial01-Minimum.html)
  * [Get comments](html/es/Tutorial02-Comments.html)
  * [Simple Bug Count](html/es/Tutorial03-Bug-Count.html)


Tutorials
----------

  - [Tutorial on querying ElasticSearch](https://github.com/klahnakoski/Qb/tree/master/docs/BZ_Tutorial.md)
  - [Tutorial on MVEL and advanced querying](https://github.com/klahnakoski/Qb/tree/master/docs/MVEL_Tutorial.md)
  - [Reference document covering the query format](https://github.com/klahnakoski/Qb/tree/master/docs/Qb_Reference.md)
  - [Dimension Definitions](https://github.com/klahnakoski/Qb/tree/master/docs/Dimension Definitions.md)
