import { createElement as h, options, render, createRef, Component, Fragment } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'preact/hooks';
import { act, setupRerender } from 'preact/test-utils';
import { setupScratch, teardown, clearOptions, serializeHtml } from '../../../test/_util/helpers';
import { serializeVNode, initDebug } from '../../src/debug';
import * as PropTypes from 'prop-types';

/** @jsx h */

describe('debug', () => {
	let scratch;
	let errors = [];
	let warnings = [];

	let diffSpy;

	beforeEach(() => {
		errors = [];
		warnings = [];
		scratch = setupScratch();
		sinon.stub(console, 'error').callsFake(e => errors.push(e));
		sinon.stub(console, 'warn').callsFake(w => warnings.push(w));

		clearOptions();
		diffSpy = sinon.spy();
		options._diff = diffSpy;

		initDebug();
	});

	afterEach(() => {

		/** @type {*} */
		(console.error).restore();
		(console.warn).restore();
		teardown(scratch);
	});

	it('should call previous options', () => {
		render(<div />, scratch);
		expect(diffSpy, 'diff').to.have.been.called;
	});

	it('should print an error on rendering on undefined parent', () => {
		let fn = () => render(<div />, undefined);
		expect(fn).to.throw(/render/);
	});

	it('should print an error on rendering on invalid parent', () => {
		let fn = () => render(<div />, 6);
		expect(fn).to.throw(/valid HTML node/);
		expect(fn).to.throw(/<div/);
	});

	it('should print an error with (function) component name when available', () => {
		const App = () => <div />;
		let fn = () => render(<App />, 6);
		expect(fn).to.throw(/<App/);
		expect(fn).to.throw(/6/);
		fn = () => render(<App />, {});
		expect(fn).to.throw(/<App/);
		expect(fn).to.throw(/[object Object]/);
	});

	it('should print an error with (class) component name when available', () => {
		class App extends Component {
			render() {
				return <div />;
			}
		}
		let fn = () => render(<App />, 6);
		expect(fn).to.throw(/<App/);
	});

	it('should print an error on undefined component', () => {
		let fn = () => render(h(undefined), scratch);
		expect(fn).to.throw(/createElement/);
	});

	it('should print an error on invalid object component', () => {
		let fn = () => render(h({}), scratch);
		expect(fn).to.throw(/createElement/);
	});

	it('should add __source to the vnode in debug mode.', () => {
		const vnode = h('div', {
			__source: {
				fileName: 'div.jsx',
				lineNumber: 3
			}
		});
		expect(vnode.__source).to.deep.equal({
			fileName: 'div.jsx',
			lineNumber: 3
		});
		expect(vnode.props.__source).to.be.undefined;
	});

	it('should add __self to the vnode in debug mode.', () => {
		const vnode = h('div', {
			__self: {}
		});
		expect(vnode.__self).to.deep.equal({});
		expect(vnode.props.__self).to.be.undefined;
	});

	// TODO: Fix this test. It only passed before because App was the first component
	// into render so currentComponent in hooks/index.js wasn't set yet. However,
	// any children under App wouldn't have thrown the error if they did what App
	// did because currentComponent would be set to App.
	// In other words, hooks never clear currentComponent so once it is set, it won't
	// be unset
	it.skip('should throw an error when using a hook outside a render', () => {
		const Foo = props => props.children;
		class App extends Component {
			componentWillMount() {
				useState();
			}

			render() {
				return <p>test</p>;
			}
		}
		const fn = () => act(() => render(<Foo><App /></Foo>, scratch));
		expect(fn).to.throw(/Hook can only be invoked from render/);
	});

	// TODO: Fix this test. It only passed before because render was never called.
	// Once render is called, currentComponent is set and never unset so calls to
	// hooks outside of components would still work.
	it.skip('should throw an error when invoked outside of a component', () => {
		function Foo(props) {
			useEffect(() => {}); // Pretend to use a hook
			return props.children;
		}

		const fn = () => act(() => {
			render(<Foo>Hello!</Foo>, scratch);
			useState();
		});
		expect(fn).to.throw(/Hook can only be invoked from render/);
	});

	it('should warn for argumentless useEffect hooks', () => {
		const App = () => {
			const [state] = useState('test');
			useEffect(() => 'test');
			return (
				<p>{state}</p>
			);
		};
		render(<App />, scratch);
		expect(warnings[0]).to.match(/You should provide an array of arguments/);
		render(<App />, scratch);
		expect(warnings[1]).to.be.undefined;
	});

	it('should warn for argumentless useLayoutEffect hooks', () => {
		const App = () => {
			const [state] = useState('test');
			useLayoutEffect(() => 'test');
			return (
				<p>{state}</p>
			);
		};
		render(<App />, scratch);
		expect(warnings[0]).to.match(/You should provide an array of arguments/);
		render(<App />, scratch);
		expect(warnings[1]).to.be.undefined;
	});

	it('should not warn for argumented effect hooks', () => {
		const App = () => {
			const [state] = useState('test');
			useLayoutEffect(() => 'test', []);
			useEffect(() => 'test', [state]);
			return (
				<p>{state}</p>
			);
		};
		const fn = () => act(() => render(<App />, scratch));
		expect(fn).to.not.throw();
	});

	it('should print an error on double jsx conversion', () => {
		let Foo = <div />;
		let fn = () => render(h(<Foo />), scratch);
		expect(fn).to.throw(/createElement/);
	});

	it('should throw errors when accessing certain attributes', () => {
		const vnode = h('div', null);
		expect(() => vnode).to.not.throw();
		expect(() => vnode.attributes).to.throw(/use vnode.props/);
		expect(() => vnode.nodeName).to.throw(/use vnode.type/);
		expect(() => vnode.children).to.throw(/use vnode.props.children/);
		expect(() => vnode.attributes = {}).to.throw(/use vnode.props/);
		expect(() => vnode.nodeName = 'test').to.throw(/use vnode.type/);
		expect(() => vnode.children = [<div />]).to.throw(/use vnode.props.children/);
	});

	it('should print an error when component is an array', () => {
		let fn = () => render(h([<div />]), scratch);
		expect(fn).to.throw(/createElement/);
	});

	it('should warn when calling setState inside the constructor', () => {
		class Foo extends Component {
			constructor(props) {
				super(props);
				this.setState({ foo: true });
			}
			render() {
				return <div>foo</div>;
			}
		}

		render(<Foo />, scratch);
		expect(console.warn).to.be.calledOnce;
		expect(console.warn.args[0]).to.match(/no-op/);
	});

	it('should print an error when child is a plain object', () => {
		let fn = () => render(<div>{{}}</div>, scratch);
		expect(fn).to.throw(/not valid/);
	});

	it('should warn for useless useMemo calls', () => {
		const App = () => {
			const [people] = useState([40, 20, 60, 80]);
			const retiredPeople = useMemo(() => people.filter(x => x >= 60));
			const cb = useCallback(() => () => 'test');
			return <p onClick={cb}>{retiredPeople.map(x => x)}</p>;
		};
		render(<App />, scratch);
		expect(warnings.length).to.equal(2);
	});

	it('should warn when non-array args is passed', () => {
		const App = () => {
			const foo = useMemo(() => 'foo', 12);
			return <p>{foo}</p>;
		};
		render(<App />, scratch);
		expect(warnings[0]).to.match(/without passing arguments/);
	});

	it('should print an error on invalid refs', () => {
		let fn = () => render(<div ref="a" />, scratch);
		expect(fn).to.throw(/createRef/);

		// Allow strings for compat
		let vnode = <div ref="a" />;

		/** @type {*} */
		(vnode).$$typeof = 'foo';
		render(vnode, scratch);
		expect(console.error).to.not.be.called;
	});

	it('should not print for null as a handler', () => {
		let fn = () => render(<div onclick={null} />, scratch);
		expect(fn).not.to.throw();
	});

	it('should not print for undefined as a handler', () => {
		let fn = () => render(<div onclick={undefined} />, scratch);
		expect(fn).not.to.throw();
	});

	it('should not print for attributes starting with on for Components', () => {
		const Comp = () => <p>online</p>;
		let fn = () => render(<Comp online={false} />, scratch);
		expect(fn).not.to.throw();
	});

	it('should print an error on invalid handler', () => {
		let fn = () => render(<div onclick="a" />, scratch);
		expect(fn).to.throw(/"onclick" property should be a function/);
	});

	it('should NOT print an error on valid refs', () => {
		let noop = () => {};
		render(<div ref={noop} />, scratch);

		let ref = createRef();
		render(<div ref={ref} />, scratch);
		expect(console.error).to.not.be.called;
	});

	it('should throw an error when missing Suspense', () => {
		const Foo = () => <div>Foo</div>;
		const LazyComp = lazy(() => new Promise(resolve => resolve({ default: Foo })));
		const fn = () => {
			render((
				<Fragment>
					<LazyComp />
				</Fragment>
			), scratch);
		};

		expect(fn).to.throw(/Missing Suspense/gi);
	});

	describe('duplicate keys', () => {
		const List = props => <ul>{props.children}</ul>;
		const ListItem = props => <li>{props.children}</li>;

		it('should print an error on duplicate keys with DOM nodes', () => {
			render(<div><span key="a" /><span key="a" /></div>, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('should allow distinct object keys', () => {
			const A = { is: 'A' };
			const B = { is: 'B' };
			render(<div><span key={A} /><span key={B} /></div>, scratch);
			expect(console.error).not.to.be.called;
		});

		it('should print an error for duplicate object keys', () => {
			const A = { is: 'A' };
			render(<div><span key={A} /><span key={A} /></div>, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('should print an error on duplicate keys with Components', () => {
			function App() {
				return (
					<List>
						<ListItem key="a">a</ListItem>
						<ListItem key="b">b</ListItem>
						<ListItem key="b">d</ListItem>
						<ListItem key="d">d</ListItem>
					</List>
				);
			}

			render(<App />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('should print an error on duplicate keys with Fragments', () => {
			function App() {
				return (
					<Fragment>
						<List key="list">
							<ListItem key="a">a</ListItem>
							<ListItem key="b">b</ListItem>
							<Fragment key="b">
								{/* Should be okay to duplicate keys since these are inside a Fragment */}
								<ListItem key="a">c</ListItem>
								<ListItem key="b">d</ListItem>
								<ListItem key="c">e</ListItem>
							</Fragment>
							<ListItem key="f">f</ListItem>
						</List>
						<div key="list">sibling</div>
					</Fragment>
				);
			}

			render(<App />, scratch);
			expect(console.error).to.be.calledTwice;
		});
	});

	describe('serializeVNode', () => {
		it('should prefer a function component\'s displayName', () => {
			function Foo() {
				return <div />;
			}
			Foo.displayName = 'Bar';

			expect(serializeVNode(<Foo />)).to.equal('<Bar />');
		});

		it('should prefer a class component\'s displayName', () => {
			class Bar extends Component {
				render() {
					return <div />;
				}
			}
			Bar.displayName = 'Foo';

			expect(serializeVNode(<Bar />)).to.equal('<Foo />');
		});

		it('should serialize vnodes without children', () => {
			expect(serializeVNode(<br />)).to.equal('<br />');
		});

		it('should serialize vnodes with children', () => {
			expect(serializeVNode(<div>Hello World</div>)).to.equal('<div>..</div>');
		});

		it('should serialize components', () => {
			function Foo() {
				return <div />;
			}
			expect(serializeVNode(<Foo />)).to.equal('<Foo />');
		});

		it('should serialize props', () => {
			expect(serializeVNode(<div class="foo" />)).to.equal('<div class="foo" />');

			let noop = () => {};
			expect(serializeVNode(<div onClick={noop} />))
				.to.equal('<div onClick="function noop() {}" />');

			function Foo(props) {
				return props.foo;
			}

			expect(serializeVNode(<Foo foo={[1, 2, 3]} />))
				.to.equal('<Foo foo="1,2,3" />');
		});
	});

	describe('table markup', () => {
		it('missing <tbody>/<thead>/<tfoot>/<table>', () => {
			const Table = () => (
				<tr><td>hi</td></tr>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('missing <table> with <thead>', () => {
			const Table = () => (
				<thead><tr><td>hi</td></tr></thead>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('missing <table> with <tbody>', () => {
			const Table = () => (
				<tbody><tr><td>hi</td></tr></tbody>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('missing <table> with <tfoot>', () => {
			const Table = () => (
				<tfoot><tr><td>hi</td></tr></tfoot>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('missing <tr>', () => {
			const Table = () => (
				<table>
					<tbody>
						<td>Hi</td>
					</tbody>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('missing <tr> with td component', () => {
			const Cell = ({ children }) => <td>{children}</td>;
			const Table = () => (
				<table>
					<tbody>
						<Cell>Hi</Cell>
					</tbody>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('missing <tr> with th component', () => {
			const Cell = ({ children }) => <th>{children}</th>;
			const Table = () => (
				<table>
					<tbody>
						<Cell>Hi</Cell>
					</tbody>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.be.calledOnce;
		});

		it('Should accept <td> instead of <th> in <thead>', () => {
			const Table = () => (
				<table>
					<thead>
						<tr>
							<td>Hi</td>
						</tr>
					</thead>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.not.be.called;
		});

		it('Accepts well formed table with TD components', () => {
			const Cell = ({ children }) => <td>{children}</td>;
			const Table = () => (
				<table>
					<thead>
						<tr>
							<th>Head</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Body</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<Cell>Body</Cell>
						</tr>
					</tfoot>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.not.be.called;
		});

		it('Accepts well formed table', () => {
			const Table = () => (
				<table>
					<thead>
						<tr>
							<th>Head</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Body</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<td>Body</td>
						</tr>
					</tfoot>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.not.be.called;
		});

		it('Accepts minimal well formed table', () => {
			const Table = () => (
				<table>
					<tr>
						<th>Head</th>
					</tr>
					<tr>
						<td>Body</td>
					</tr>
				</table>
			);
			render(<Table />, scratch);
			expect(console.error).to.not.be.called;
		});
	});


	describe('PropTypes', () => {
		it('should fail if props don\'t match prop-types', () => {
			function Foo(props) {
				return <h1>{props.text}</h1>;
			}

			Foo.propTypes = {
				text: PropTypes.string.isRequired
			};

			render(<Foo />, scratch);

			expect(console.error).to.be.calledOnce;
			expect(errors[0].includes('required')).to.equal(true);
		});

		it('should render with error logged when validator gets signal and throws exception', () => {
			function Baz(props) {
				return <h1>{props.unhappy}</h1>;
			}

			Baz.propTypes = {
				unhappy: function alwaysThrows(obj, key) { if (obj[key] === 'signal') throw Error('got prop'); }
			};

			render(<Baz unhappy={'signal'} />, scratch);

			expect(console.error).to.be.calledOnce;
			expect(errors[0].includes('got prop')).to.equal(true);
			expect(serializeHtml(scratch)).to.equal('<h1>signal</h1>');
		});

		it('should not print to console when types are correct', () => {
			function Bar(props) {
				return <h1>{props.text}</h1>;
			}

			Bar.propTypes = {
				text: PropTypes.string.isRequired
			};

			render(<Bar text="foo" />, scratch);
			expect(console.error).to.not.be.called;
		});

		it('should validate propTypes inside lazy()', () => {
			const rerender = setupRerender();

			function Baz(props) {
				return <h1>{props.unhappy}</h1>;
			}

			Baz.propTypes = {
				unhappy: function alwaysThrows(obj, key) {
					if (obj[key] === 'signal') {
						throw Error('got prop inside lazy()');
					}
				}
			};


			const loader = Promise.resolve({ default: Baz });
			const LazyBaz = lazy(() => loader);

			const suspense = (
				<Suspense fallback={<div>fallback...</div>}>
					<LazyBaz unhappy="signal" />
				</Suspense>
			);
			render(suspense, scratch);
			rerender(); // Render fallback

			expect(console.error).to.not.be.called;

			return loader
				.then(() => Promise.all(suspense._component._suspensions))
				.then(() => {
					rerender();
					expect(errors.length).to.equal(1);
					expect(errors[0].includes('got prop')).to.equal(true);
					expect(serializeHtml(scratch)).to.equal('<h1>signal</h1>');
				});
		});

		it('should throw on missing <Suspense>', () => {
			function Foo() {
				throw Promise.resolve();
			}

			expect(() => render(<Foo />, scratch)).to.throw;
		});

		describe('warn for PropTypes on lazy()', () => {
			it('should log the function name', () => {
				const loader = Promise.resolve({ default: function MyLazyLoadedComponent() { return <div>Hi there</div>; } });
				const FakeLazy = lazy(() => loader);
				FakeLazy.propTypes = {};
				const suspense = (
					<Suspense fallback={<div>fallback...</div>} >
						<FakeLazy />
					</Suspense>
				);
				render(suspense, scratch);

				return loader
					.then(() => Promise.all(suspense._component._suspensions))
					.then(() => {
						expect(console.warn).to.be.calledTwice;
						expect(warnings[1].includes('MyLazyLoadedComponent')).to.equal(true);
					});
			});

			it('should log the displayName', () => {
				function MyLazyLoadedComponent() { return <div>Hi there</div>; }
				MyLazyLoadedComponent.displayName = 'HelloLazy';
				const loader = Promise.resolve({ default: MyLazyLoadedComponent });
				const FakeLazy = lazy(() => loader);
				FakeLazy.propTypes = {};
				const suspense = (
					<Suspense fallback={<div>fallback...</div>} >
						<FakeLazy />
					</Suspense>
				);
				render(suspense, scratch);

				return loader
					.then(() => Promise.all(suspense._component._suspensions))
					.then(() => {
						expect(console.warn).to.be.calledTwice;
						expect(warnings[1].includes('HelloLazy')).to.equal(true);
					});
			});

			it('should not log a component if lazy throws', () => {
				const loader = Promise.reject(new Error('Hey there'));
				const FakeLazy = lazy(() => loader);
				FakeLazy.propTypes = {};
				render(
					<Suspense fallback={<div>fallback...</div>} >
						<FakeLazy />
					</Suspense>,
					scratch
				);

				return loader.catch(() => {
					expect(console.warn).to.be.calledOnce;
				});
			});

			it('should not log a component if lazy\'s loader throws', () => {
				const FakeLazy = lazy(() => { throw new Error('Hello'); });
				FakeLazy.propTypes = {};
				let error;
				try {
					render(
						<Suspense fallback={<div>fallback...</div>} >
							<FakeLazy />
						</Suspense>,
						scratch
					);
				}
				catch (e) {
					error = e;
				}

				expect(console.warn).to.be.calledOnce;
				expect(error).not.to.be.undefined;
				expect(error.message).to.eql('Hello');
			});
		});
	});
});
