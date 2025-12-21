/** @type {import('xo').FlatXoConfig} */
const xoConfig = [
	{
		prettier: true,
		rules: {
			"react/prop-types": "off",
			"import-x/extensions": "off",
			"n/file-extension-in-import": "off",
			"react/jsx-closing-tag-location": "off",
			"react/react-in-jsx-scope": "off",
			camelcase: "off",
			"react/jsx-indent": "off",
			"import-x/no-anonymous-default-export": "off",
			"unicorn/no-anonymous-default-export": "off",
			complexity: "off",
		},
	},
];

export default xoConfig;
