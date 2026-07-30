import * as Ast from '@unified-latex/unified-latex-types';
import { EnvInfo } from '@unified-latex/unified-latex-types';
import { EnvInfoRecord } from '@unified-latex/unified-latex-types';
import { Plugin as Plugin_2 } from 'unified';

declare type PluginOptions = {
    environments: EnvInfoRecord;
} | undefined;

/**
 * Performs any needed processing on the environment (as specified by `envInfo`)
 * including attaching arguments and possibly manipulating the environment's body.
 */
export declare function processEnvironment(envNode: Ast.Environment, envInfo: EnvInfo): void;

/**
 * Recursively search for and process the specified environments. Arguments are
 * consumed according to the `signature` specified. The body is processed
 * with the specified `processContent` function (if given). Any specified `renderInfo`
 * is attached to the environment node.
 */
export declare function processEnvironments(tree: Ast.Ast, environments: EnvInfoRecord): void;

/**
 * Unified plugin to process environment content and attach arguments.
 *
 * @param environments An object whose keys are environment names and values contains information about the environment and its argument signature.
 */
export declare const unifiedLatexProcessEnvironments: Plugin_2<PluginOptions[], Ast.Root, Ast.Root>;

export { }
