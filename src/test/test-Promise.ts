/**
 * Promise tests for functionality not covered by Promises A+ tests.
 *
 * Copyright (C) 2015 Martin Poelstra
 * License: MIT
 */

/// <reference path="../../typings/node/node.d.ts" />
/// <reference path="../../typings/mocha/mocha.d.ts" />
/// <reference path="../../typings/chai/chai.d.ts" />

"use strict";

require("source-map-support").install();

import assert = require("assert");
import chai = require("chai");
import Trace from "../lib/Trace";
import { Promise, Thenable, UnhandledRejectionError, Deferred } from "../lib/Promise";

import expect = chai.expect;

describe("Promise", (): void => {

	it("calls then()'s in a logical order", (): void => {
		var resolve: (v: number) => void;
		var p = new Promise((res: any, rej: any): void => {
			resolve = res;
		});
		var result: number[] = [];
		p.then((): void => { result.push(1); }).done((): void => { result.push(3); });
		p.then((): void => { result.push(2); }).done((): void => { result.push(4); });
		resolve(42);
		Promise.flush();
		expect(result).to.deep.equal([1, 2, 3, 4]);
	});

	describe("constructor()", () => {
		/*
		it("requires the `new` operator", () => {
			// Disabled, because:
			// - it requires the typeof checks in the constructor to be
			//   moved up (less efficient for the most common case)
			// - it requires the property initialization to be moved into the
			//   constructor (after the typeof checks)
			// - still doesn't protect that well, because ES6 imports are called
			//   with the module as their `this`
			// - Typescript already checks for it
			var constr = <any>Promise;
			expect(() => constr(function() { })).to.throw(TypeError);
			expect(() => constr(function() { })).to.throw("forget `new`");
		});
		*/
		it("requires a resolver function", () => {
			function test(arg?: any) {
				expect(() => new Promise(arg)).to.throw(TypeError);
				expect(() => new Promise(arg)).to.throw("is not a function");
			}
			test();
			test(false);
			test(true);
			test({});
			test("");
		});
		it("returns a fulfilled promise when resolve is called", () => {
			var p = new Promise<number>((resolve, reject) => {
				resolve(42);
			});
			var result: number;
			p.then((v) => result = v);
			Promise.flush();
			expect(result).to.equal(42);
		});
		it("returns a rejected promise when reject is called", () => {
			var p = new Promise<number>((resolve, reject) => {
				reject(new Error("boom"));
			});
			var result: any;
			p.catch((r) => result = r);
			Promise.flush();
			expect(result).to.be.instanceof(Error);
		});
		it("returns a rejected promise when resolver throws", () => {
			var p = new Promise<number>((resolve, reject) => {
				throw new Error("boom");
			});
			var result: any;
			p.catch((r) => result = r);
			Promise.flush();
			expect(result).to.be.instanceof(Error);
		});
		it("returns a resolved promise when resolver throws after resolve is called", () => {
			var p = new Promise<number>((resolve, reject) => {
				resolve(42);
				throw new Error("boom");
			});
			var result: number;
			p.then((v) => result = v);
			Promise.flush();
			expect(result).to.be.equal(42);
		});
	}); // constructor()

	describe(".all()", (): void => {
		it("should resolve immediately for empty array", (): Promise<any> => {
			return Promise.all([]).then((results): void => {
				expect(results).to.deep.equal([]);
			});
		});
		it("should resolve with results after all Promises have resolved", (): Promise<any> => {
			var d1 = Promise.defer<number>();
			var d2 = Promise.defer<number>();
			setTimeout(() => d1.resolve(1), 10);
			setTimeout(() => d2.resolve(2), 20);
			return Promise.all([d1.promise, d2.promise]).then((results): void => {
				expect(results).to.deep.equal([1, 2]);
			});
		});
		it("should reject when one Promise fails", (): Promise<any> => {
			var d1 = Promise.defer<number>();
			var d2 = Promise.defer<number>();
			setTimeout(() => d1.reject(new Error("boom")), 10);
			setTimeout(() => d2.resolve(2), 20);
			return Promise.all([d1.promise, d2.promise]).catch((e: Error): void => {
				expect(e.message).to.contain("boom");
			});
		});
		it("should recursively resolve Thenables", () => {
			var results: number[];
			var d1 = Promise.defer<number>();
			var d2 = Promise.defer<number>();
			Promise.all([d1.promise, d2.promise]).then((r) => results = r);
			d1.resolve(d2.promise);
			Promise.flush();
			expect(results).to.be.undefined;
			d2.resolve(2);
			Promise.flush();
			expect(results).to.deep.equal([2, 2]);
		});
		it("should accept non-Thenables", () => {
			var results: number[];
			var d1 = Promise.defer<number>();
			Promise.all([d1.promise, 2]).then((r) => results = r);
			Promise.flush();
			expect(results).to.be.undefined;
			d1.resolve(1);
			Promise.flush();
			expect(results).to.deep.equal([1, 2]);
		});
		it("should accept non-Promise Thenables", () => {
			var results: number[];
			var callback: (n: number) => void;
			// Create rather dirty Promise-mock
			var thenable: Thenable<number> = {
				then: (cb: Function): Thenable<any> => { callback = <any>cb; return null; }
			}
			Promise.all([thenable]).then((r) => results = r);
			callback(42);
			expect(results).to.be.undefined;
			Promise.flush();
			expect(results).to.deep.equal([42]);
		});
	}); // .all()

	describe(".race()", (): void => {
		it("should never resolve for empty array", (): void => {
			var p = Promise.race([]);
			Promise.flush();
			expect(p.isPending()).to.equal(true);
		});
		it("should resolve with first promise's result", (): Promise<any> => {
			var d1 = Promise.defer<number>();
			var d2 = Promise.defer<number>();
			setTimeout(() => d1.resolve(1), 20);
			setTimeout(() => d2.resolve(2), 10);
			return Promise.race([d1.promise, d2.promise]).then((result): void => {
				expect(result).to.deep.equal(2);
			});
		});
		it("should reject when one Promise fails", (): Promise<any> => {
			var d1 = Promise.defer<number>();
			var d2 = Promise.defer<number>();
			setTimeout(() => d1.reject(new Error("boom")), 10);
			setTimeout(() => d2.resolve(2), 20);
			return Promise.race([d1.promise, d2.promise]).catch((e: Error): void => {
				expect(e.message).to.contain("boom");
			});
		});
		it("should recursively resolve Thenables", () => {
			var result: number;
			var d1 = Promise.defer<number>();
			var d2 = Promise.defer<number>();
			Promise.race([d1.promise]).then((n) => result = n);
			d1.resolve(d2.promise);
			Promise.flush();
			expect(result).to.be.undefined;
			d2.resolve(2);
			Promise.flush();
			expect(result).to.deep.equal(2);
		});
		it("should accept non-Thenables", () => {
			var result: number;
			var d1 = Promise.defer<number>();
			Promise.race([d1.promise, 2]).then((n) => result = n);
			Promise.flush();
			expect(result).to.equal(2);
		});
		it("should accept non-Promise Thenables", () => {
			var result: number;
			var callback: (n: number) => void;
			// Create rather dirty Promise-mock
			var thenable: Thenable<number> = {
				then: (cb: Function): Thenable<any> => { callback = <any>cb; return null; }
			}
			Promise.race([thenable]).then((n) => result = n);
			callback(42);
			expect(result).to.be.undefined;
			Promise.flush();
			expect(result).to.equal(42);
		});
	}); // .race()

	describe(".delay()", () => {
		it("resolves to void after given timeout, given no value", (done: MochaDone) => {
			var p = Promise.delay(10);
			Promise.flush();
			expect(p.isPending()).to.equal(true);
			p.then((v) => {
				expect(v).to.equal(undefined);
				done();
			});
		});
		it("resolves to a value after given timeout, given a value", (done: MochaDone) => {
			var p = Promise.delay(42, 10);
			Promise.flush();
			expect(p.isPending()).to.equal(true);
			p.then((v) => {
				expect(v).to.equal(42);
				done();
			});
		});
		it("resolves to a value after given timeout, given a Thenable", (done: MochaDone) => {
			var t = Promise.resolve(42);
			var p = Promise.delay(t, 10);
			Promise.flush();
			expect(p.isPending()).to.equal(true);
			p.then((v) => {
				expect(v).to.equal(42);
				done();
			});
		});
		it("immediately rejects, given a rejected Thenable", () => {
			var t = Promise.reject(new Error("boom"));
			var p = Promise.delay(t, 1000);
			Promise.flush();
			expect(p.isRejected()).to.equal(true);
			expect(p.reason().message).to.equal("boom");
		});
	});

	describe(".defer", () => {
		var d: Deferred<number>;
		beforeEach(() => {
			d = Promise.defer<number>();
		})
		it("is initially pending", () => {
			expect(d.promise.isPending()).to.be.true;
		});
		it("it can be resolved once", () => {
			d.resolve(42);
			d.resolve(1);
			d.reject(new Error("boom"));
			Promise.flush();
			expect(d.promise.value()).to.equal(42);
		});
		it("it can be rejected once", () => {
			var e = new Error("boom");
			d.reject(e);
			d.resolve(1);
			d.reject(new Error("bla"));
			Promise.flush();
			expect(d.promise.reason()).to.equal(e);
		});
		it("it can be rejected using rejected Thenable", () => {
			var e = new Error("boom");
			var d2 = Promise.defer<number>();
			d.resolve(d2.promise);
			d.resolve(1);
			d.reject(new Error("bla"));
			Promise.flush();
			expect(d.promise.isPending()).to.be.true;
			d2.reject(e);
			Promise.flush();
			expect(d.promise.reason()).to.equal(e);
		});
		it("VoidDeferred can be resolved using Thenable", () => {
			var d = Promise.defer();
			d.resolve(Promise.resolve()); // Mostly for the TS typing
			Promise.flush();
			expect(d.promise.isFulfilled()).to.equal(true);
		});
	});

	describe("#then()", () => {
		// All other cases already handled by Promise/A+ tests

		it("ignores no handlers, returns Promise of same type", () => {
			let p = Promise.resolve(42);
			let actual = p.then<number>();
			let expected: Promise<number>;
			expected = actual;
			actual = expected;
			Promise.flush();
			expect(actual.value()).to.equal(42);
		});
		it("has correct typing for just fulfillment handler", () => {
			let p = Promise.resolve(42);
			let actual = p.then((n) => String(n));
			let expected: Promise<string>;
			expected = actual;
			actual = expected;
		});
		it("has correct typing for just rejection handler", () => {
			let p = Promise.resolve(42);
			let actual = p.then(undefined, (e) => String(e));
			let expected: Promise<string|number>;
			expected = actual;
			actual = expected;
		});
	});

	describe("#catch()", () => {
		// All other cases already handled by Promise/A+ tests

		it("ignores no handler, returns Promise of same type", () => {
			let p = Promise.resolve(42);
			let actual = p.catch<number>();
			let expected: Promise<number>;
			expected = actual;
			actual = expected;
			Promise.flush();
			expect(actual.value()).to.equal(42);
		});
		it("has correct typing for catch handler that returns same type", () => {
			let p = Promise.resolve(42);
			let actual = p.catch((n) => 1337);
			let expected: Promise<number>;
			expected = actual;
			actual = expected;
		});
		it("has correct typing for catch handler that returns different type", () => {
			let p = Promise.resolve(42);
			let actual = p.catch((n) => String(n));
			let expected: Promise<string|number>;
			expected = actual;
			actual = expected;
		});
		it("has correct typing for catch handler that only throws error", () => {
			let p = Promise.resolve(42);
			let actual = p.catch((n): number => { throw new Error("boom"); });
			let expected: Promise<number>;
			expected = actual;
			actual = expected;
		});
		it("has correct typing for catch handler that only returns rejection", () => {
			let p = Promise.resolve(42);
			let actual = p.catch(
				(n) => Promise.reject<number>(new Error("boom"))
			);
			let expected: Promise<number>;
			expected = actual;
			actual = expected;
		});
	});

	describe("#done()", (): void => {
		it("is silent on already resolved promise", (): void => {
			Promise.resolve(42).done();
			expect(() => Promise.flush()).to.not.throw();
		});
		it("is silent on later resolved promise", (): void => {
			var d = Promise.defer<number>();
			d.promise.done();
			d.resolve(42);
			expect(() => Promise.flush()).to.not.throw();
		});
		it("is silent when its fulfill callback returns non-Error", (): void => {
			Promise.resolve(42).done((v) => undefined);
			expect(() => Promise.flush()).to.not.throw();
		});
		it("is silent when its fulfill callback returns non-Error Promise", (): void => {
			Promise.resolve(42).done((v) => Promise.resolve());
			expect(() => Promise.flush()).to.not.throw();
		});
		it("is silent when its reject callback returns non-Error", (): void => {
			Promise.reject(new Error("boom")).done(null, (r) => undefined);
			expect(() => Promise.flush()).to.not.throw();
		});
		it("is silent when its reject callback returns non-Error Promise", (): void => {
			Promise.reject(new Error("boom")).done(null, (r) => Promise.resolve());
			expect(() => Promise.flush()).to.not.throw();
		});
		it("is silent when its reject callback returns non-Error Thenable", (): void => {
			var thenable: Thenable<void> = {
				then: (cb: Function): Thenable<any> => { cb(); return null; }
			}
			Promise.reject(new Error("boom")).done(null, (r) => thenable);
			expect(() => Promise.flush()).to.not.throw();
		});
		it("should immediately break on thrown error in normal callback", (): void => {
			var ready = false;
			Promise.resolve().done(() => { throw new Error("boom"); });
			Promise.resolve().then((): void => {
				ready = true;
			});
			expect(() => Promise.flush()).to.throw(UnhandledRejectionError);
			expect(ready).to.be.false;
			Promise.flush();
			expect(ready).to.be.true;
		});
		it("should immediately break on thrown error in error callback", (): void => {
			var ready = false;
			Promise.reject(new Error("dummy")).done(undefined, () => { throw new Error("boom"); });
			Promise.resolve().then((): void => {
				ready = true;
			});
			expect(() => Promise.flush()).to.throw(UnhandledRejectionError);
			expect(ready).to.be.false;
			Promise.flush();
			expect(ready).to.be.true;
		});
		it("should immediately break on returned rejection in callback", (): void => {
			Promise.resolve().done((): Promise<void> => {
				return Promise.reject(new Error("boom"));
			});
			expect(() => Promise.flush()).to.throw(UnhandledRejectionError);
		});
		it("should immediately break on asynchronously rejected Thenable", (): void => {
			var d = Promise.defer();
			Promise.resolve().done((): Promise<void> => {
				return d.promise;
			});
			Promise.flush();
			d.reject(new Error("boom"));
			expect(() => Promise.flush()).to.throw(UnhandledRejectionError);
		});
		it("should break on already rejected promise", (): void => {
			var ready = false;
			Promise.reject(new Error("boom")).done();
			Promise.resolve().then((): void => {
				ready = true;
			});
			expect(() => Promise.flush()).to.throw(UnhandledRejectionError);
			expect(ready).to.be.false;
			Promise.flush();
			expect(ready).to.be.true;
		});
		it("should break on asynchronously rejected Promise", (): void => {
			var d = Promise.defer();
			var p = Promise.resolve();
			p.then((): Promise<void> => {
				return d.promise;
			}).done();
			Promise.flush();
			d.reject(new Error("boom"));
			expect(() => Promise.flush()).to.throw(UnhandledRejectionError);
		});
		it("should support long traces on throw from callback", () => {
			Promise.setLongTraces(true);
			Promise.resolve().done(() => { throw new Error("boom"); });
			var caught: UnhandledRejectionError;
			try {
				Promise.flush();
			} catch(e) {
				caught = e;
			}
			expect(caught).to.be.instanceof(UnhandledRejectionError);
			// TODO: assert the trace property for correctness
			expect(caught.trace.inspect()).to.not.contain("no trace");
			Promise.setLongTraces(false);
		});
		it("should support long traces on throw from callback without non-long-trace source", () => {
			var p = Promise.resolve();
			Promise.setLongTraces(true);
			p.done(() => { throw new Error("boom"); });
			var caught: UnhandledRejectionError;
			try {
				Promise.flush();
			} catch(e) {
				caught = e;
			}
			expect(caught).to.be.instanceof(UnhandledRejectionError);
			// TODO: assert the trace property for correctness
			expect(caught.trace.inspect()).to.not.contain("no trace");
			Promise.setLongTraces(false);
		});
		it("should support long traces on rejection without callbacks", () => {
			Promise.setLongTraces(true);
			Promise.reject(new Error("boom")).done();
			var caught: UnhandledRejectionError;
			try {
				Promise.flush();
			} catch(e) {
				caught = e;
			}
			expect(caught).to.be.instanceof(UnhandledRejectionError);
			// TODO: assert the trace property for correctness
			expect(caught.trace.inspect()).to.not.contain("no trace");
			Promise.setLongTraces(false);
		});
	}); // #done()

	describe("#isFulfilled()", () => {
		it("is false while pending, true when fulfilled", () => {
			var d = Promise.defer();
			expect(d.promise.isFulfilled()).to.equal(false);
			Promise.flush();
			expect(d.promise.isFulfilled()).to.equal(false);
			d.resolve();
			expect(d.promise.isFulfilled()).to.equal(true);
			Promise.flush();
			expect(d.promise.isFulfilled()).to.equal(true);
		});
		it("is true when already fulfilled", () => {
			var p = Promise.resolve();
			expect(p.isFulfilled()).to.equal(true);
		});
		it("is false when rejected", () => {
			var p = Promise.reject(new Error("boom"));
			expect(p.isFulfilled()).to.equal(false);
		});
	});

	describe("#isRejected()", () => {
		it("is false while pending, true when rejected", () => {
			var d = Promise.defer();
			expect(d.promise.isRejected()).to.equal(false);
			Promise.flush();
			expect(d.promise.isRejected()).to.equal(false);
			d.reject(new Error("boom"));
			expect(d.promise.isRejected()).to.equal(true);
			Promise.flush();
			expect(d.promise.isRejected()).to.equal(true);
		});
		it("is true when already rejected", () => {
			var p = Promise.reject(new Error("boom"));
			expect(p.isRejected()).to.equal(true);
		});
		it("is false when fulfilled", () => {
			var p = Promise.resolve();
			expect(p.isRejected()).to.equal(false);
		});
	});

	describe("#isPending()", () => {
		it("is true while pending, false when resolved or rejected", () => {
			var d1 = Promise.defer();
			var d2 = Promise.defer();
			expect(d1.promise.isPending()).to.equal(true);
			expect(d2.promise.isPending()).to.equal(true);
			Promise.flush();
			expect(d1.promise.isPending()).to.equal(true);
			expect(d2.promise.isPending()).to.equal(true);
			d1.resolve();
			d2.reject(new Error("boom"));
			expect(d1.promise.isPending()).to.equal(false);
			expect(d2.promise.isPending()).to.equal(false);
			Promise.flush();
			expect(d1.promise.isPending()).to.equal(false);
			expect(d2.promise.isPending()).to.equal(false);
		});
		it("is false when already fulfilled", () => {
			var p = Promise.resolve();
			expect(p.isPending()).to.equal(false);
		});
		it("is false when already rejected", () => {
			var p = Promise.reject(new Error("boom"));
			expect(p.isPending()).to.equal(false);
		});
	});

	describe("#value()", () => {
		it("returns value when fulfilled", () => {
			var p = Promise.resolve(42);
			Promise.flush();
			expect(p.value()).to.equal(42);
		});
		it("throws an error while pending", () => {
			var p = Promise.defer().promise;
			Promise.flush();
			expect(() => p.value()).to.throw("not fulfilled");
		});
	});

	describe("#reason()", () => {
		it("returns reason when rejected", () => {
			var e = new Error("boom");
			var p = Promise.reject(e);
			Promise.flush();
			expect(p.reason()).to.equal(e);
		});
		it("throws an error while pending", () => {
			var p = Promise.defer().promise;
			Promise.flush();
			expect(() => p.reason()).to.throw("not rejected");
		});
	});

	describe("#toString()", () => {
		it("returns a readable representation for a pending Promise", () => {
			var p = Promise.defer().promise;
			expect(p.toString()).to.match(/^\[Promise \d+: pending\]$/);
		});
		it("returns a readable representation for a fulfilled Promise", () => {
			var p = Promise.resolve();
			expect(p.toString()).to.match(/^\[Promise \d+: fulfilled\]$/);
		});
		it("returns a readable representation for a rejected Promise", () => {
			var p = Promise.reject(new Error("boom"));
			expect(p.toString()).to.match(/^\[Promise \d+: rejected\]$/);
		});
	});

	describe("#inspect()", () => {
		it("returns a readable representation for a pending Promise", () => {
			var p = Promise.defer().promise;
			expect(p.inspect()).to.match(/^\[Promise \d+: pending\]$/);
		});
		it("returns a readable representation for a fulfilled Promise", () => {
			var p = Promise.resolve();
			expect(p.inspect()).to.match(/^\[Promise \d+: fulfilled\]$/);
		});
		it("returns a readable representation for a rejected Promise", () => {
			var p = Promise.reject(new Error("boom"));
			expect(p.inspect()).to.match(/^\[Promise \d+: rejected\]$/);
		});
	});

	describe("#delay()", () => {
		it("resolves to same value after given timeout", (done: MochaDone) => {
			var p = Promise.resolve(42).delay(10);
			Promise.flush();
			expect(p.isPending()).to.equal(true);
			p.then((v) => {
				expect(v).to.equal(42);
				done();
			});
		});
		it("immediately passes a rejection", () => {
			var p = Promise.reject(new Error("boom")).delay(1000);
			Promise.flush();
			expect(p.isRejected()).to.equal(true);
			expect(p.reason().message).to.equal("boom");
		});
	});

	describe("#return()", () => {
		it("waits for parent, then resolves to value", () => {
			let d = Promise.defer();
			let actual = d.promise.return("foo");
			let expected: Promise<string>;
			expected = actual;
			actual = expected;

			Promise.flush();
			expect(actual.isPending()).to.equal(true);
			d.resolve();
			Promise.flush();
			expect(actual.value()).to.equal("foo");
		});
		it("waits for parent, allows resolving to void", () => {
			let d = Promise.defer();
			let actual = d.promise.return();
			let expected: Promise<void>;
			expected = actual;
			actual = expected;
			Promise.flush();
			expect(actual.isPending()).to.equal(true);
			d.resolve();
			Promise.flush();
			expect(actual.value()).to.equal(undefined);
		});
		it("waits for parent, then passes a rejection", () => {
			let e = new Error("boom");
			let d = Promise.defer();
			let actual = d.promise.return("foo");
			let expected: Promise<string>;
			expected = actual;
			actual = expected;
			Promise.flush();
			expect(actual.isPending()).to.equal(true);
			d.reject(e);
			Promise.flush();
			expect(actual.reason()).to.equal(e);
		});
	});

	describe("#throw()", () => {
		it("waits for parent, then rejects with reason", () => {
			let e = new Error("boom");
			let d = Promise.defer<string>();
			let actual = d.promise.throw(e);
			let expected: Promise<string>;
			expected = actual;
			actual = expected;

			Promise.flush();
			expect(actual.isPending()).to.equal(true);
			d.resolve("foo");
			Promise.flush();
			expect(actual.reason()).to.equal(e);
		});
		it("waits for parent, then passes a rejection", () => {
			let e = new Error("boom");
			let originalError = new Error("original");
			let d = Promise.defer<string>();
			let actual = d.promise.throw(e);
			let expected: Promise<string>;
			expected = actual;
			actual = expected;
			Promise.flush();
			expect(actual.isPending()).to.equal(true);
			d.reject(originalError);
			Promise.flush();
			expect(actual.reason()).to.equal(originalError);
		});
	});

	describe("long stack traces", (): void => {
		before(() => {
			Promise.setLongTraces(true);
		});
		after(() => {
			Promise.setLongTraces(false);
		});
		it("should trace simple rejections", () => {
			var p = Promise.resolve();  // this line should be present
			p.then((): void => { // this line should not be present
			});
			p.then((): void => { // this line should be present
			}).then((): void => { // this line should be present
				throw new Error("boom");
			}).then((): void => { // this line should not be present
			}).then((): void => { // this line should not be present
			}).catch((e: any): void => {
				var stack = e.stack; // retrieve stack prop for coverage
				// TODO: Check stack trace
			});
			Promise.flush();
		});
		it("should trace returned rejections", () => {
			var p = Promise.resolve() // 1
				.then((): void => { // 2
					throw new Error("boom");
				}).then((): void => {
				});
			Promise.resolve()
				.then((): Promise<void> => { // 3?
					return p;
				}).catch((e: any): void => {
					// TODO: Check stack trace
				});
			Promise.flush();
		});
		it("should set the source of new Promise when it's created inside a then()-callback", () => {
			var p: Promise<void>;
			Promise.resolve() // 1
				.then((): void => { // 2
					p = Promise.resolve(); // 3
				}).then((): void => {
				});
			Promise.flush();
			// TODO: Check stack trace if p
		});
	}); // long stack traces

	describe("tracer", () => {
		after(() => {
			Promise.setTracer(null);
		});
		// These tests are for getting full code coverage for now, results
		// should be tested later
		it("calls tracer when resolving", () => {
			var traces: string[] = [];
			Promise.setTracer((promise: Promise<any>, msg: string) => {
				traces.push(msg);
			});
			Promise.resolve(42).then((v) => {
				expect(v).to.equal(42);
			});
			Promise.reject(new Error("boom")).catch((r) => {
				expect(r).to.be.instanceof(Error);
			});
			Promise.resolve(42).done();
			Promise.resolve(42).done((v) => {});
			Promise.resolve(Promise.resolve(42));
			var d = Promise.defer<number>();
			Promise.resolve(d.promise);
			d.resolve(42);
			Promise.resolve({ then: (callback: Function) => {
				callback(42);
			}});
			Promise.flush();
			//console.log(traces);
		});
	}); // tracer
});

describe("UnhandledRejectionError", () => {
	describe("constructor()", () => {
		it("includes reason in message", () => {
			var e = new Error("boom");
			var ure = new UnhandledRejectionError(e, new Trace());
			expect(ure.message).to.contain("Error: boom");
		});
		it("sets its .reason property to the original error", () => {
			var e = new Error("boom");
			var ure = new UnhandledRejectionError(e, new Trace());
			expect(ure.reason).to.equal(e);
		});
	});
});
