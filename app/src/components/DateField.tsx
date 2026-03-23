/**
 * Cross-platform date input.
 * - Web: plain TextInput accepting YYYY-MM-DD
 * - Native: Pressable that opens @react-native-community/datetimepicker
 */
import React, { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatDate } from '@/utils/dates';

interface Props {
  value: string;          // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;     // NativeWind class for the trigger button
  minimumDate?: Date;
}

export default function DateField({ value, onChange, placeholder = 'Select date', className, minimumDate }: Props) {
  const [showPicker, setShowPicker] = useState(false);

  const inputCls = className ??
    'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-200 text-base';

  if (Platform.OS === 'web') {
    return (
      <TextInput
        className={inputCls}
        value={value}
        onChangeText={(t) => {
          // Accept YYYY-MM-DD directly
          if (/^\d{4}-\d{2}-\d{2}$/.test(t)) onChange(t);
          else onChange(t); // still update so typing works
        }}
        onBlur={(e) => {
          const t = (e.nativeEvent as any).text ?? value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(t)) onChange(t);
        }}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#4b5563"
        keyboardType="numeric"
        maxLength={10}
      />
    );
  }

  return (
    <View>
      <Pressable
        onPress={() => setShowPicker(true)}
        className={`${inputCls} justify-center`}
      >
        <Text className={value ? 'text-gray-200 text-base' : 'text-gray-600 text-base'}>
          {value ? formatDate(value) : placeholder}
        </Text>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          onChange={(_, date) => {
            setShowPicker(Platform.OS === 'ios');
            if (date) onChange(date.toISOString().slice(0, 10));
          }}
        />
      )}
    </View>
  );
}
