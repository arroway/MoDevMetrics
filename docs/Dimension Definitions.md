
Dimension Definitions
---------------------

To simplify query writing, we borrow from the Business Intelligence software field and define a complicated type hierarchy over the various fields and measures found in the cube.  Beyond query simplification, we also get minor ETL, a central schema definition, improved formatting, and organization.

A dimension can consists of child edges or child partitions.  Child edges are allowed to overlap each other's domains, and represent orthogonal ways to cut the same data.  Child partitions divide the dimension into mutually exclusive parts.  A well-behaved partition will cover the dimension's domain, ill-behaved partitions are "compiled" to be well-behaved so nothing is missed.

Dimensions are similar to domain clauses in CUBE queries, with additional attributes to help apply that domain over many different queries.

  - **name** - humane words to describe the child dimension
  - **field** - ull path name of a field in the json record.  This will be used as the value in the query's edge 
  - **value** - unction to convert a part object into a humane string for final presentation.  
  - **format** - onvenience attribute instead of using the value function to convert a part to a string.  This will look at the type of domain, and use the default formatting function for that type.
  - **set** - ype of domain 
  - **esfilter** - imits the domain to a subset.  If this is undefined, then it will default to the union of all child dimensions.  This can often be bad because the esfilter can get complicated.  You will often see "esfilter":ESQuery.TrueFilter to simply set the domain to everything.
  - **isFacet** - orce the partitions of this dimension to be split into ES facets.  This is required when the documents need to be multiply counted
  - **path** -  function that will map a value (usually pulled from ```field```) and converts it to partition path.  The dimension definition allows the programmer to define partitions of partitions, forming a tree.  A partition path is a path through that tree.  In the event the tree is left undefined, the datasource will be used to find all values and build the tree using the path function.  Return a single value if you want to simply parse a value into a nicer set of parts.
  - **edges** - the child edges, with further dimension attributes
  - **default** - suggested limits for algebraic dimensions ( min, max, interval)
  - **partitions** - he child partitions, which can be further partitioned if required
