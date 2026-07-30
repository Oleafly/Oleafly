'use client';

import * as React from 'react';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { getCombinedFieldValidityData } from "../../field/utils/getCombinedFieldValidityData.mjs";
import { useFormContext } from "../form-context/FormContext.mjs";
export function useFieldControlRegistration(params) {
  const {
    commit,
    invalid,
    markedDirtyRef,
    name,
    setRegisteredFieldName,
    setRegisteredFieldId,
    setValidityData,
    validityData
  } = params;
  const {
    formRef
  } = useFormContext();
  const activeFieldControlSourceRef = React.useRef(null);
  const registrationRef = React.useRef(null);
  const fallbackControlRef = React.useRef(null);
  const getValueForForm = useStableCallback(() => {
    const registration = registrationRef.current;
    if (!registration) {
      return undefined;
    }
    if (registration.getValue) {
      return registration.getValue();
    }
    return registration.value;
  });
  function getRegistrationValue(registration) {
    return registration.value === undefined ? getValueForForm() : registration.value;
  }
  const validate = useStableCallback(() => {
    const registration = registrationRef.current;
    markedDirtyRef.current = true;
    if (!registration) {
      commit(validityData.value);
      return;
    }
    commit(getRegistrationValue(registration));
  });
  function refreshRegistration() {
    const registration = registrationRef.current;
    if (!registration || !registration.id) {
      return;
    }
    formRef.current.fields.set(registration.id, {
      getValue: getValueForForm,
      name: name ?? registration.name,
      controlRef: registration.controlRef ?? fallbackControlRef,
      validityData: getCombinedFieldValidityData(validityData, invalid),
      validate
    });
  }
  function deleteRegistration(id = registrationRef.current?.id) {
    if (id) {
      formRef.current.fields.delete(id);
    }
  }
  function syncInitialValue() {
    const registration = registrationRef.current;
    if (!registration) {
      return;
    }
    const initialValue = getRegistrationValue(registration);
    if (validityData.initialValue === null && initialValue !== null) {
      setValidityData(prev => ({
        ...prev,
        initialValue
      }));
    }
  }
  useIsoLayoutEffect(() => {
    const registration = registrationRef.current;
    if (!registration || !registration.id) {
      return;
    }
    setRegisteredFieldName(name ? undefined : registration.name);
    formRef.current.fields.set(registration.id, {
      getValue: getValueForForm,
      name: name ?? registration.name,
      controlRef: registration.controlRef ?? fallbackControlRef,
      validityData: getCombinedFieldValidityData(validityData, invalid),
      validate
    });
  }, [formRef, getValueForForm, invalid, name, setRegisteredFieldName, validate, validityData]);
  useIsoLayoutEffect(() => {
    const fields = formRef.current.fields;
    return () => {
      const id = registrationRef.current?.id;
      if (id) {
        fields.delete(id);
      }
    };
  }, [formRef]);
  const register = useStableCallback((source, registration) => {
    if (!registration) {
      if (activeFieldControlSourceRef.current === source) {
        activeFieldControlSourceRef.current = null;
        deleteRegistration();
        registrationRef.current = null;
        setRegisteredFieldName(undefined);
        setRegisteredFieldId(undefined);
      }
      return;
    }
    const previousId = registrationRef.current?.id;
    activeFieldControlSourceRef.current = source;
    registrationRef.current = registration;
    if (!name) {
      setRegisteredFieldName(registration.name);
    }
    setRegisteredFieldId(registration.id);
    if (previousId && previousId !== registration.id) {
      deleteRegistration(previousId);
    }
    syncInitialValue();
    refreshRegistration();
  });
  return [validate, register];
}