/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Controller, useForm, useWatch } from "react-hook-form";
import { Lightbulb } from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceAIConfigurationKeys } from "@plane/types";
import { CustomSelect } from "@plane/ui";
// components
import type { TControllerInputFormField } from "@/components/common/controller-input";
import { ControllerInput } from "@/components/common/controller-input";
// hooks
import { useInstance } from "@/hooks/store";

type IInstanceAIForm = {
  config: IFormattedInstanceConfiguration;
};

type AIFormValues = Record<TInstanceAIConfigurationKeys, string>;

/**
 * Per-provider copy and links. The keys here must match the values the API's
 * SUPPORTED_PROVIDERS map accepts (plane/app/views/external/base.py) -- the string
 * chosen here is written straight to the LLM_PROVIDER instance configuration and is
 * what decides which SDK the backend routes a request through.
 */
const LLM_PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    article: "an",
    heading: "Anthropic",
    tagline: "If you use Claude, this is for you.",
    modelPlaceholder: "claude-sonnet-5",
    modelDocsHref: "https://docs.claude.com/en/docs/about-claude/models/overview",
    modelDocsAriaLabel: "Anthropic model documentation",
    apiKeyHref: "https://console.anthropic.com/settings/keys",
    apiKeyAriaLabel: "Anthropic API keys page",
    apiKeyPlaceholder: "sk-ant-api03-...",
  },
  openai: {
    label: "OpenAI",
    article: "an",
    heading: "OpenAI",
    tagline: "If you use ChatGPT, this is for you.",
    modelPlaceholder: "gpt-4o-mini",
    modelDocsHref: "https://platform.openai.com/docs/models/overview",
    modelDocsAriaLabel: "OpenAI models documentation",
    apiKeyHref: "https://platform.openai.com/api-keys",
    apiKeyAriaLabel: "OpenAI API keys page",
    apiKeyPlaceholder: "sk-...",
  },
  gemini: {
    label: "Gemini",
    article: "a",
    heading: "Google Gemini",
    tagline: "If you use Google AI Studio, this is for you.",
    modelPlaceholder: "gemini-pro",
    modelDocsHref: "https://ai.google.dev/gemini-api/docs/models/gemini",
    modelDocsAriaLabel: "Gemini model documentation",
    apiKeyHref: "https://aistudio.google.com/app/apikey",
    apiKeyAriaLabel: "Google AI Studio API keys page",
    apiKeyPlaceholder: "AIza...",
  },
} as const;

type TLLMProviderKey = keyof typeof LLM_PROVIDERS;

const DEFAULT_PROVIDER: TLLMProviderKey = "anthropic";

const isSupportedProvider = (value: string | undefined): value is TLLMProviderKey =>
  !!value && value in LLM_PROVIDERS;

/**
 * An instance seeded before this form existed can hold an empty or unrecognised
 * LLM_PROVIDER row. Fall back rather than rendering an empty select the admin
 * cannot reason about.
 */
const resolveProvider = (value: string | undefined): TLLMProviderKey =>
  isSupportedProvider(value?.trim().toLowerCase()) ? (value!.trim().toLowerCase() as TLLMProviderKey) : DEFAULT_PROVIDER;

export function InstanceAIForm(props: IInstanceAIForm) {
  const { config } = props;
  // store
  const { updateInstanceConfigurations } = useInstance();
  // form data
  const {
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AIFormValues>({
    defaultValues: {
      LLM_PROVIDER: resolveProvider(config["LLM_PROVIDER"]),
      LLM_API_KEY: config["LLM_API_KEY"],
      LLM_MODEL: config["LLM_MODEL"],
    },
  });

  // the selected provider drives every label, placeholder and doc link below
  const selectedProvider = resolveProvider(useWatch({ control, name: "LLM_PROVIDER" }));
  const providerConfig = LLM_PROVIDERS[selectedProvider];

  const aiFormFields: TControllerInputFormField[] = [
    {
      key: "LLM_MODEL",
      type: "text",
      label: "LLM Model",
      description: (
        <>
          Choose {providerConfig.article} {providerConfig.label} model.{" "}
          <a
            href={providerConfig.modelDocsHref}
            target="_blank"
            className="text-accent-primary hover:underline"
            rel="noreferrer"
            aria-label={providerConfig.modelDocsAriaLabel}
          >
            Learn more
          </a>
        </>
      ),
      placeholder: providerConfig.modelPlaceholder,
      error: Boolean(errors.LLM_MODEL),
      required: false,
    },
    {
      key: "LLM_API_KEY",
      type: "password",
      label: "API key",
      description: (
        <>
          You will find your {providerConfig.label} API key{" "}
          <a
            href={providerConfig.apiKeyHref}
            target="_blank"
            className="text-accent-primary hover:underline"
            rel="noreferrer"
            aria-label={providerConfig.apiKeyAriaLabel}
          >
            here.
          </a>
        </>
      ),
      placeholder: providerConfig.apiKeyPlaceholder,
      error: Boolean(errors.LLM_API_KEY),
      required: false,
    },
  ];

  const onSubmit = async (formData: AIFormValues) => {
    const payload: Partial<AIFormValues> = { ...formData };

    await updateInstanceConfigurations(payload)
      .then(() =>
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Success",
          message: "AI Settings updated successfully",
        })
      )
      .catch((err) => console.error(err));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <div className="pb-1 text-18 font-medium text-primary">{providerConfig.heading}</div>
          <div className="text-13 font-regular text-tertiary">{providerConfig.tagline}</div>
        </div>
        <div className="grid-col grid w-full grid-cols-1 items-center justify-between gap-x-12 gap-y-8 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <h4 className="text-13 text-tertiary">Provider</h4>
            <Controller
              control={control}
              name="LLM_PROVIDER"
              render={({ field: { value, onChange } }) => (
                <CustomSelect
                  value={resolveProvider(value)}
                  label={LLM_PROVIDERS[resolveProvider(value)].label}
                  onChange={onChange}
                  buttonClassName="rounded-md border-subtle"
                  input
                >
                  {Object.entries(LLM_PROVIDERS).map(([key, provider]) => (
                    <CustomSelect.Option key={key} value={key} className="w-full">
                      {provider.label}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              )}
            />
            <p className="pt-0.5 text-11 text-tertiary">
              Decides which vendor your API key and model are sent to. Change this before saving a key from a different
              vendor.
            </p>
          </div>
          {aiFormFields.map((field) => (
            <ControllerInput
              key={field.key}
              control={control}
              type={field.type}
              name={field.key}
              label={field.label}
              description={field.description}
              placeholder={field.placeholder}
              error={field.error}
              required={field.required}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-start gap-4">
        <Button variant="primary" size="lg" onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
          {isSubmitting ? "Saving" : "Save changes"}
        </Button>

        <div className="relative inline-flex items-center gap-1.5 rounded-sm border border-accent-subtle bg-accent-subtle px-4 py-2 text-caption-sm-regular text-accent-secondary">
          <Lightbulb className="size-4" />
          <div>
            If you have a preferred AI models vendor, please get in{" "}
            <a className="font-medium underline" href="https://kirancableppl.com">
              touch with us.
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
