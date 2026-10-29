import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';
import * as preview from './preview';

/** The stories run under the same theme and parameters as in the Storybook. */
const project = setProjectAnnotations([preview]);

beforeAll(project.beforeAll);
