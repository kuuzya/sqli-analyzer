var fs = require('fs');
var path = require('path');
var engine = require('php-parser');


//////////// traversing AST
function inspect(ast) {
//  console.log(ast.kind);
  if (ast == null) {
    return;
  }

  // 
  if (ast.hasOwnProperty('children')) {
    inspect_body(ast.children);
  }
  if (ast.hasOwnProperty('body')) {
    inspect_body(ast.body);
  }
  if (ast.hasOwnProperty('alternate')) {
    inspect_body(ast.alternate);
  }

  if (ast.kind === 'call') {
    inspect_call(ast);
  }
}

// body ::= block | null | array<decl> | stmt | array<node>
function inspect_body(body) {
//  console.log(ast)
  if (ast == null || ast == false) { 
    return;
  } else if (Array.isArray(body)) {
      body.forEach(function(element) {
        inspect(element);
      }, this);
  } else {
    inspect(body);
  }
}

//////////// utility function to inspect AST
function is_global_function_call(what) {
  return what.kind === 'identifier';
}

function is_mysqli_staticlookup(what) {
  return what.kind === 'staticlookup' && 
         what.what.kind === 'identifier' &&
         what.what.name === 'mysqli' &&
         what.offset.kind === 'constref';
}

function is_PDO_propertylookup(what) {
  return what.kind === 'propertylookup' && 
         what.offset.kind === 'constref';
}


function is_sql_query_function(what) {
  if (is_global_function_call(what)) {
    return ['mysql_query', 'mysqli_query'].includes(what.name);
} else if (is_PDO_propertylookup(what)) {
    return what.offset.name === 'query';
  } else if (is_mysqli_staticlookup(what)) {
    return what.offset.name === 'query';
  }

  return false;
}

function is_sql_escape_function(what) {
  if (is_global_function_call(what)) {
    return ['mysql_escape_string', 'mysql_real_escape_string', 'mysqli_escape_string', 'mysqli_real_escape_string'].includes(what.name);
} else if (is_PDO_propertylookup(what)) {
    return what.offset.name === 'quote';
  } else if (is_mysqli_staticlookup(what)) {
    return what.offset.name === 'real_escape_string';
  }

  return false;
}


/////// inspect inside function call
function inspect_call(ast) {  
  if (is_sql_query_function(ast.what)) {
    inspect_sql_query_string(ast.arguments[0]);
  }
}

/** flatten linked list of boolean operator `.'
  * @param ast: AST of the first argument of sql-query functions
  * @returns: array of each element
  */
function flatten_string_concatenation(ast) {
  if (ast.kind === 'bin' && ast.type === '.') {
    var rest = flatten_string_concatenation(ast.left);
    return rest.concat(flatten_string_concatenation(ast.right));
  } else if (ast.kind === 'encapsed') {
    // unfold encapsed string, like "hello, {$name}!"
    return ast.value.reduce(function(prev, current, index, arr) {
      return prev.concat(flatten_string_concatenation(current));
    }, []);
  } else if (ast.kind === 'parenthesis') {
    // (hoge) => hoge
    return flatten_string_concatenation(ast.inner);
  } else {
    return [ast];
  }
}

var karma = 0;

function alert_vulnerability(ast, msg) {
  console.log(`WARNING at line ${ast.loc.start.line}:`,  msg);
  karma += 1;
}

function report_total_result() {
  if (karma === 0) {
    console.log("RESULT: OK");
  } else {
    console.log(`RESULT: ${karma} warnings`);
  }
}

// check surrounding strings are good for escaping
// only simple checks are done in this step
function inspect_escaping_strings(left, right) {
  if (left === undefined) {
    alert_vulnerability(left, "bad variable position");    
  }
  if (right === undefined) {
    alert_vulnerability(right, "bad variable position");    
  }
  if (left.kind !== 'string') {
    alert_vulnerability(left, "expression before variable is not string");    
  }
  if (right.kind !== 'string') {
    alert_vulnerability(right, "expression before variable is not string");    
  }

  var l = left.value;
  var r = right.value;

  if ((l[l.length - 1] === "'" && r[0] === "'") ||
      (l[l.length - 1] === "'" && r[0] === "'")) {
//    console.log(l, r);
    return;
  } else {
    alert_vulnerability(l, "variable is not properly escaped by enclosing strings");
  }
}

// inspect the first argument of sql_query function
function inspect_sql_query_string(ast) {
  var flatten = flatten_string_concatenation(ast);
  
  flatten.forEach(function(value, index, array) {
    if (value.kind === 'string') {
      // ok
    } else if (value.kind === 'call' && is_sql_escape_function(value.what)) {
      var left = array[index - 1]; // get surrounding string 
      var right = array[index + 1];

      inspect_escaping_strings(left, right);
    } else {
      alert_vulnerability(value, 'value is not escaped');
    }
  }, this);

}

// initialize a new PHP parser
var parser = new engine({
  // some options :
  parser: {
    extractDoc: true
  },
  ast: {
    withPositions: true
  }
});

// read file from stdin
var buffer = fs.readFileSync('/dev/stdin', 'utf8');


try {
  var ast = parser.parseCode(buffer, "stdin");
  inspect(ast);
} catch (e) {
  console.log(`ERROR: syntax error in '${e.fileName}' at ${e.lineNumber}:${e.columnNumber}`);
  console.log(`ERROR: no analysis done`);

  throw e;
} finally  {
  report_total_result();
}
